import { approveMessageDraft, createMessageDraft } from "@/features/approvals/service";
import { sendFirstContact } from "@/integrations/browser/service";
import type { BrowserGateway } from "@/integrations/browser/gateway";

export function approvedFixture(leadId: number, body: string, channel: "browser" | "api") {
  const draft = createMessageDraft({ leadId, body, channel, purpose: channel === "browser" ? "first_contact" : "reply", reason: "Explicit human approval fixture, in-memory test only" });
  return approveMessageDraft({ id: draft.id, expectedVersion: draft.version, directHistoryChecked: channel === "browser" });
}

export async function sendReviewedFirstContact(jobId: number, leadId: number, body: string, gateway: BrowserGateway, dryRun: boolean) {
  const approval = approvedFixture(leadId, body, "browser");
  return sendFirstContact(jobId, leadId, body, gateway, dryRun, approval.id);
}
