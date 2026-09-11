CREATE TABLE "workspace_administrative_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_administrative_event" ADD CONSTRAINT "workspace_administrative_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_administrative_event" ADD CONSTRAINT "workspace_administrative_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_admin_event_workspace_occurred_idx" ON "workspace_administrative_event" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE FUNCTION "reject_workspace_administrative_event_mutation"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'workspace_administrative_event is append-only'
		USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workspace_administrative_event_append_only"
BEFORE UPDATE OR DELETE ON "workspace_administrative_event"
FOR EACH ROW EXECUTE FUNCTION "reject_workspace_administrative_event_mutation"();
