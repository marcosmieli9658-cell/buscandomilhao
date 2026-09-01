"use server";

import { revalidatePath } from "next/cache";
import { database } from "@/db/client";
import { discoverLead, scoreLead } from "@/features/leads/service";
import { enqueueJob, setGlobalPause } from "@/worker/queue";

export async function togglePause(formData: FormData): Promise<void> {
  const paused = formData.get("paused") === "true";
  setGlobalPause(paused, paused ? "Pausado pelo operador" : null);
  revalidatePath("/");
}

export async function addLead(formData: FormData): Promise<void> {
  const input = {
    funnel: formData.get("funnel") === "affiliate" ? "affiliate" as const : "client" as const,
    instagramHandle: String(formData.get("instagramHandle") ?? ""),
    displayName: String(formData.get("displayName") ?? "") || undefined,
    bio: String(formData.get("bio") ?? "") || undefined,
    category: String(formData.get("category") ?? "") || undefined,
    location: String(formData.get("location") ?? "") || undefined,
    segment: String(formData.get("segment") ?? "") || undefined,
    source: "operator",
  };
  const result = discoverLead({ ...input, score: scoreLead(input) });
  enqueueJob("qualify_lead", { leadId: result.lead.id }, { dedupeKey: `qualify_lead:${result.lead.id}` });
  revalidatePath("/");
  revalidatePath("/leads");
}

export async function startDiscovery(formData: FormData): Promise<void> {
  const keyword = String(formData.get("keyword") ?? "").trim();
  if (!keyword) throw new Error("Informe uma palavra-chave.");
  enqueueJob("discover_instagram", { keyword, funnel: "client" }, { dedupeKey: `discover_instagram:${keyword.toLowerCase()}:${new Date().toISOString().slice(0, 10)}` });
  revalidatePath("/operations");
}

export async function resumeBrowserQueue(): Promise<void> {
  database.sqlite.prepare("UPDATE system_settings SET browser_queue_paused = 0, browser_pause_reason = NULL, updated_at = ? WHERE id = 1").run(Date.now());
  revalidatePath("/operations");
}
