import express, { Router } from 'express';
import { rescueRouter } from './routes/rescue';
import { calleWebhookRouter } from './routes/calleWebhook';

export const apiRouter = Router();

// Middleware for parsing JSON
apiRouter.use(express.json());

// Mount API route groups
apiRouter.use('/rescue', rescueRouter);
apiRouter.use('/calle', calleWebhookRouter);

export default apiRouter;
