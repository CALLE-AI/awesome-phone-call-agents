import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { transcribeAudioBuffer } from "./_core/voiceTranscription";
import { calleService } from "./calle/service";
import { billingService } from "./billing/service";
import { billingErrorMessage } from "./billing/errors";
import { mapErrorToUserMessage } from "./calle/error-taxonomy";
import { resolveWorkflowErrorMessage, toTrpcCause } from "./_core/workflow-errors";
import { confirmCallInputSchema, prepareCallInputSchema } from "./calle/types";
import { resolveCallLanguage } from "./calle/call-language-capability";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  voice: router({
    transcribe: publicProcedure
      .input(
        z.object({
          audioBase64: z.string().min(1).max(12_000_000),
          mimeType: z.string().min(3).max(100).default("audio/m4a"),
          language: z.string().min(2).max(16).optional(),
          prompt: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const audioBuffer = Buffer.from(input.audioBase64, "base64");
        const result = await transcribeAudioBuffer({
          audioBuffer,
          mimeType: input.mimeType,
          language: input.language,
          prompt: input.prompt,
        });
        if ("error" in result) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: result.error,
            cause: result,
          });
        }
        return { text: result.text, language: result.language, duration: result.duration };
      }),
  }),

  calle: router({
    capabilities: protectedProcedure.query(() => calleService.getCapabilities()),
    resolveCallLanguage: protectedProcedure
      .input(
        z.object({
          requested: z.string().min(1).max(16),
          backup: z.string().max(16).optional(),
          organizationDefault: z.string().max(16).optional(),
          interpreterNeeded: z.boolean().optional(),
        }),
      )
      .query(({ input }) => resolveCallLanguage(input)),
    demoCatalog: protectedProcedure.query(() => calleService.getDemoCatalog()),
    queueHealth: protectedProcedure.query(() => calleService.getQueueHealth()),
    preflight: protectedProcedure.input(prepareCallInputSchema).query(({ input }) => {
      return calleService.preflight(input);
    }),
    runDemoScenario: protectedProcedure
      .input(z.object({ beneficiaryId: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await calleService.runDemoScenario(input.beneficiaryId, ctx.user.id);
          if (!result.ok) {
            const code = result.code ?? "demo_scenario_failed";
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: resolveWorkflowErrorMessage(code),
              cause: toTrpcCause(code),
            });
          }
          return result;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: mapErrorToUserMessage("demo_scenario_failed").userMessage,
            cause: toTrpcCause("demo_scenario_failed"),
          });
        }
      }),
    callTimeline: protectedProcedure
      .input(z.object({ workflowId: z.string().min(1).max(64) }))
      .query(({ input }) => ({ timeline: calleService.getCallTimeline(input.workflowId) })),
    prepare: protectedProcedure.input(prepareCallInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await calleService.prepare(input, ctx.user.id);
      } catch (error) {
        const code =
          error instanceof Error && error.message.includes("CALL_E_ENABLED")
            ? "call_e_disabled"
            : "internal_error";
        throw new TRPCError({
          code: code === "call_e_disabled" ? "PRECONDITION_FAILED" : "INTERNAL_SERVER_ERROR",
          message: resolveWorkflowErrorMessage(code),
          cause: toTrpcCause(code),
        });
      }
    }),
    confirm: protectedProcedure.input(confirmCallInputSchema).mutation(async ({ ctx, input }) => {
      try {
        const result = await calleService.confirm(input, ctx.user.id);
        if (!result.ok) {
          const billingMessage =
            "billingMessage" in result ? result.billingMessage : undefined;
          throw new TRPCError({
            code: result.code === "unauthorized" ? "FORBIDDEN" : "BAD_REQUEST",
            message: resolveWorkflowErrorMessage(result.code, billingMessage),
            cause: toTrpcCause(result.code, {
              upgradePlanId:
                "upgradePlanId" in result ? result.upgradePlanId : undefined,
            }),
          });
        }
        if (result.followUp) {
          try {
            await db.upsertFollowUpRecord({
              userId: ctx.user.id,
              dedupeKey: `calle:${result.workflow.id}`,
              womanId: result.workflow.womanId,
              contactMethod: result.followUp.contactMethod,
              outcome: result.followUp.outcome,
              note: result.followUp.note,
              nextAction: result.followUp.nextAction,
              status: "completed",
              clientUpdatedAt: new Date(),
            });
          } catch {
            // Local device persistence + sync queue remain the source of truth when DB is offline.
          }
        }
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: mapErrorToUserMessage("internal_error").userMessage,
          cause: toTrpcCause("internal_error"),
        });
      }
    }),
    status: protectedProcedure
      .input(z.object({ workflowId: z.string().min(1).max(64) }))
      .query(async ({ ctx, input }) => {
        const workflow = await calleService.getStatus(input.workflowId, ctx.user.id);
        if (!workflow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
        }
        return { workflow };
      }),
    cancel: protectedProcedure
      .input(z.object({ workflowId: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const result = await calleService.cancel(input.workflowId, ctx.user.id);
        if (!result.ok) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: resolveWorkflowErrorMessage(result.code ?? "unauthorized"),
            cause: toTrpcCause(result.code ?? "unauthorized"),
          });
        }
        return result;
      }),
    commandCenter: protectedProcedure
      .input(
        z
          .object({
            bucket: z
              .enum(["pending", "active", "completed", "blocked", "failed", "needs_review"])
              .optional(),
            purpose: z
              .enum([
                "follow_up_after_check_in",
                "appointment_coordination",
                "callback_confirmation",
              ])
              .optional(),
            demoOnly: z.boolean().optional(),
          })
          .optional(),
      )
      .query(({ ctx, input }) => calleService.listCommandCenter(ctx.user.id, input ?? {})),
    callDetail: protectedProcedure
      .input(z.object({ workflowId: z.string().min(1).max(64) }))
      .query(async ({ ctx, input }) => {
        const detail = await calleService.getCallDetail(input.workflowId, ctx.user.id);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Call not found" });
        }
        return detail;
      }),
    compileIntent: protectedProcedure.input(prepareCallInputSchema).query(({ input }) => {
      return calleService.compileIntent(input);
    }),
    compileColloquial: protectedProcedure
      .input(z.object({ text: z.string().min(3).max(500) }))
      .query(({ input }) => calleService.compileColloquial(input.text)),
    validateConfig: protectedProcedure.query(() => calleService.validateConfig()),
    heroDemo: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        const result = await calleService.runHeroDemo(ctx.user.id);
        if (!result.ok) {
          const code = result.code ?? "hero_demo_failed";
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: resolveWorkflowErrorMessage(code),
            cause: toTrpcCause(code),
          });
        }
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: mapErrorToUserMessage("hero_demo_failed").userMessage,
          cause: toTrpcCause("hero_demo_failed"),
        });
      }
    }),
    releaseReport: protectedProcedure.query(() => calleService.getReleaseReport()),
  }),

  billing: router({
    catalog: protectedProcedure.query(() => billingService.getCatalog()),
    entitlements: protectedProcedure.query(({ ctx }) => {
      try {
        billingService.seedDemoEntitlements(ctx.user.id);
        return billingService.getEntitlements(ctx.user.id);
      } catch {
        return billingService.getEntitlements(ctx.user.id);
      }
    }),
    usage: protectedProcedure.query(({ ctx }) => billingService.getUsageSummary(ctx.user.id)),
    pricingViewed: protectedProcedure.mutation(({ ctx }) => {
      billingService.recordPricingViewed(ctx.user.id);
      return { ok: true as const };
    }),
    startPurchase: protectedProcedure
      .input(z.object({ planId: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const result = await billingService.startPurchase(ctx.user.id, input.planId);
        if ("ok" in result && result.ok === false && "code" in result) {
          const message =
            "message" in result && result.message
              ? result.message
              : billingErrorMessage(result.code, result.code);
          throw new TRPCError({ code: "BAD_REQUEST", message, cause: { code: result.code } });
        }
        return result;
      }),
    verifyPurchase: protectedProcedure
      .input(
        z.object({
          planId: z.string().min(1).max(64),
          receiptToken: z.string().min(8).max(256),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await billingService.verifyPurchase(
          ctx.user.id,
          input.planId,
          input.receiptToken,
        );
        if ("ok" in result && result.ok === false && "code" in result) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: billingErrorMessage(result.code, result.code),
            cause: toTrpcCause(result.code),
          });
        }
        return result;
      }),
    restorePurchases: protectedProcedure.mutation(async ({ ctx }) => {
      const result = await billingService.restorePurchases(ctx.user.id);
      if ("ok" in result && result.ok === false) {
        const message =
          "message" in result && result.message
            ? result.message
            : billingErrorMessage(result.code ?? "billing_unavailable");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
          cause: { code: "code" in result ? result.code : "billing_unavailable" },
        });
      }
      return result;
    }),
    explainPlan: protectedProcedure
      .input(
        z.object({
          planId: z.string().min(1).max(64),
          language: z.enum(["en", "bn"]).optional(),
        }),
      )
      .query(({ input }) =>
        billingService.explainPlan(input.planId, input.language ?? "en"),
      ),
    revenueDashboard: protectedProcedure.query(({ ctx }) => {
      const result = billingService.getRevenueDashboard(ctx.user.role);
      if (!result.ok) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }
      return result;
    }),
  }),

  sync: router({
    followUp: protectedProcedure
      .input(z.object({
        dedupeKey: z.string().min(1).max(128),
        womanId: z.string().min(1).max(128),
        contactMethod: z.enum(["visit", "phone", "sms"]),
        outcome: z.enum(["reached", "no_answer", "needs_clinician"]),
        note: z.string().max(4000),
        nextAction: z.enum(["call_again", "clinic_visit", "urgent_review", "none"]),
        status: z.literal("completed"),
        clientUpdatedAt: z.coerce.date(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await db.upsertFollowUpRecord({ ...input, userId: ctx.user.id });
        } catch {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "Could not sync follow-up to server. Saved locally on device.",
            cause: toTrpcCause("sync_unavailable"),
          });
        }
      }),

    followUps: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await db.listFollowUpRecords(ctx.user.id);
      } catch {
        return [];
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
