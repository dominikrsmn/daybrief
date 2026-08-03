CREATE TABLE "scheduled_briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbound_message_id" text NOT NULL,
	"recipient" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"briefing" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"outbound_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_briefings_inbound_message_id_unique" UNIQUE("inbound_message_id"),
	CONSTRAINT "scheduled_briefings_status_check" CHECK ("scheduled_briefings"."status" in ('pending', 'processing', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "scheduled_briefings_due_idx" ON "scheduled_briefings" USING btree ("status","scheduled_at");