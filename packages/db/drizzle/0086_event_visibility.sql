CREATE TABLE "event_visibility" (
	"user_id" text NOT NULL,
	"event_id" uuid NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"original_start" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_visibility_user_id_event_id_scope_key_pk" PRIMARY KEY("user_id","event_id","scope_key"),
	CONSTRAINT "event_visibility_scope_check" CHECK (("event_visibility"."scope_key" = '' AND "event_visibility"."original_start" IS NULL) OR ("event_visibility"."original_start" IS NOT NULL AND "event_visibility"."scope_key" = ("event_visibility"."original_start"->>'kind') || ':' || ("event_visibility"."original_start"->>'value')))
);
--> statement-breakpoint
ALTER TABLE "event_visibility" ADD CONSTRAINT "event_visibility_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_visibility" ADD CONSTRAINT "event_visibility_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;