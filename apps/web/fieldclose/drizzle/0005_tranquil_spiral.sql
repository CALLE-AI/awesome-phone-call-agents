CREATE TYPE "public"."human_disposition_outcome" AS ENUM('closeout_accepted', 'return_visit_handoff', 'manual_follow_up_handoff', 'no_further_automated_action');--> statement-breakpoint
CREATE TABLE "human_disposition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"outcome" "human_disposition_outcome" NOT NULL,
	"resolution_note" varchar(1000),
	"recorded_by" varchar(128) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_disposition_note_not_blank_ck" CHECK ("human_disposition"."resolution_note" is null or length(trim("human_disposition"."resolution_note")) > 0),
	CONSTRAINT "human_disposition_handoff_note_required_ck" CHECK ("human_disposition"."outcome" not in ('return_visit_handoff', 'manual_follow_up_handoff') or "human_disposition"."resolution_note" is not null)
);
--> statement-breakpoint
ALTER TABLE "human_disposition" ADD CONSTRAINT "human_disposition_case_id_closeout_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."closeout_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_task" ADD CONSTRAINT "follow_up_task_id_case_uq" UNIQUE("id","case_id");--> statement-breakpoint
ALTER TABLE "human_disposition" ADD CONSTRAINT "human_disposition_task_case_fk" FOREIGN KEY ("task_id","case_id") REFERENCES "public"."follow_up_task"("id","case_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "human_disposition_case_uq" ON "human_disposition" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "human_disposition_task_uq" ON "human_disposition" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "human_disposition_recorded_idx" ON "human_disposition" USING btree ("recorded_at");
