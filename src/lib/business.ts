import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const businessSchema = z.object({
  ownerName: z.string().min(1),
  ownerRole: z.string().min(1),
  companyName: z.string().min(1),
  companyWebsite: z.url(),
  instagramHandle: z.string().regex(/^@[A-Za-z0-9._]+$/),
  whatsappLink: z.url(),
  affiliateGroupLink: z.url().nullable(),
  affiliateFunnelEnabled: z.boolean(),
  oneLinePitch: z.string().min(1),
  howItWorks: z.array(z.string().min(1)).min(3),
  revenueModel: z.string().min(1),
  marketJargon: z.array(z.object({ term: z.string(), meaning: z.string() })),
  verifiedClaims: z.array(z.string().min(1)).min(1),
  unverifiedClaims: z.array(z.string().min(1)),
  icpSegments: z.array(z.string().min(1)).min(1),
  icpKeywords: z.array(z.string().min(1)).min(1),
  affiliateTopics: z.array(z.string().min(1)),
  geography: z.string().min(1),
  autonomousDiscovery: z.object({
    enabled: z.boolean(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dailyLeadLimit: z.number().int().min(1).max(50),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    keywords: z.array(z.string().min(1)).min(1),
  }).default({ enabled: false, startDate: "2099-01-01", dailyLeadLimit: 5, weekdays: [1, 2, 3, 4, 5], keywords: ["negócio local"] }),
}).superRefine((data, context) => {
  if (data.affiliateFunnelEnabled && !data.affiliateGroupLink) {
    context.addIssue({
      code: "custom",
      path: ["affiliateGroupLink"],
      message: "O funil de afiliados precisa de um link de grupo verificado.",
    });
  }
});

export type BusinessConfig = z.infer<typeof businessSchema>;

let cachedConfig: BusinessConfig | undefined;

export function getBusinessConfig(): BusinessConfig {
  if (cachedConfig) return cachedConfig;
  const filePath = path.resolve(process.cwd(), "config/business.json");
  if (!fs.existsSync(filePath)) {
    throw new Error("config/business.json não existe. Copie business.example.json e preencha os dados.");
  }
  cachedConfig = businessSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  return cachedConfig;
}

export function clearBusinessConfigCache(): void {
  cachedConfig = undefined;
}
