ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "display_username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_uq" ON "user" USING btree ("username");