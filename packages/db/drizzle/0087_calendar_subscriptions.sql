CREATE TABLE "calendar_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"calendar_id" uuid NOT NULL,
	"name" text NOT NULL,
	"encrypted_url" text NOT NULL,
	"url_hash" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_attempt_at" timestamp,
	"last_success_at" timestamp,
	"error" text,
	CONSTRAINT "calendar_subscriptions_user_id_url_hash_unique" UNIQUE("user_id","url_hash"),
	CONSTRAINT "calendar_subscriptions_calendar_id_unique" UNIQUE("calendar_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;