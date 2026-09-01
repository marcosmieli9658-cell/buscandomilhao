import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { database } from "@/db/client";
import { experimentAssignments, experiments, experimentVariants } from "@/db/schema";

export function assignActiveVariant(leadId: number, funnel: "client" | "affiliate") {
  return database.db.transaction((tx) => {
    const experiment = tx.select().from(experiments).where(and(eq(experiments.funnel, funnel), eq(experiments.status, "running"))).get();
    if (!experiment) return null;
    const existing = tx.select().from(experimentAssignments).where(and(eq(experimentAssignments.experimentId, experiment.id), eq(experimentAssignments.leadId, leadId))).get();
    if (existing) return tx.select().from(experimentVariants).where(eq(experimentVariants.id, existing.variantId)).get() ?? null;
    const variants = tx.select().from(experimentVariants).where(eq(experimentVariants.experimentId, experiment.id)).all();
    if (!variants.length) return null;
    const hash = crypto.createHash("sha256").update(`${experiment.id}:${leadId}`).digest().readUInt32BE(0) / 0xffffffff;
    let cursor = 0;
    const selected = variants.find((variant) => {
      cursor += variant.weight;
      return hash <= cursor;
    }) ?? variants.at(-1)!;
    tx.insert(experimentAssignments).values({ experimentId: experiment.id, variantId: selected.id, leadId, createdAt: new Date(), updatedAt: new Date() }).run();
    return selected;
  });
}

export function recordExperimentConversion(leadId: number, conversionEvent: string): void {
  database.db.update(experimentAssignments).set({ convertedAt: new Date(), conversionEvent, updatedAt: new Date() }).where(eq(experimentAssignments.leadId, leadId)).run();
}
