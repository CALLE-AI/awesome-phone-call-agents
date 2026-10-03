import type { Express, NextFunction, Request, Response } from "express";
import { credentialedOriginMiddleware, handleCredentialedPreflight } from "../calle/origin-policy";

export function installHardenedCors(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (handleCredentialedPreflight(req, res)) return;
    credentialedOriginMiddleware(req, res, next);
  });
}
