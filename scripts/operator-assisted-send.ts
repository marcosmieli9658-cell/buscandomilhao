import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const usage = "Uso: node --import tsx scripts/operator-assisted-send.ts --approval-id N --version N --job-id N";
const args = process.argv.slice(2);
const values = new Map<string, number>();
if (args.length !== 6) throw new Error(usage);
for (let index = 0; index < args.length; index += 2) {
  if (!["--approval-id", "--version", "--job-id"].includes(args[index]) || values.has(args[index]) || !/^[1-9]\d*$/.test(args[index + 1])) throw new Error(usage);
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value)) throw new Error(usage);
  values.set(args[index], value);
}

async function assertNoWorker(): Promise<void> {
  if (process.platform !== "win32") throw new Error("Este lançador exige a conferência de processos do Windows.");
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|cmd|powershell|pwsh)(.exe)?$' } | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 15_000 });
  const processes: unknown = JSON.parse(stdout);
  if (!Array.isArray(processes)) throw new Error("Não foi possível conferir todos os processos antes da operação.");
  const active = processes.filter((item: { ProcessId?: number; CommandLine?: string }) => item.ProcessId !== process.pid && typeof item.CommandLine === "string"
    && /(?:src[\\/]worker[\\/]index\.(?:ts|js)|dist[\\/]worker[\\/]index\.js|concurrently[^\r\n]*worker|pnpm(?:\.c?js)?[^\r\n]*\s(?:dev|start)(?:\s|$))/i.test(item.CommandLine));
  if (active.length) throw new Error("Existe worker ou lançador geral ativo. A ponte não pode continuar.");
}

await assertNoWorker();
// Set before importing application modules, whose environment is cached. Never writes .env.
process.env.DRY_RUN = "false";
const { runAssistedSend, waitForAssistedAcknowledgement } = await import("../src/integrations/browser/operator-assisted");
const controller = new AbortController();
const cancel = () => controller.abort(new Error("Operação interrompida pelo operador; conferir o Direct antes de qualquer nova tentativa."));
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const result = await runAssistedSend({ approvalId: values.get("--approval-id")!, approvalVersion: values.get("--version")!, jobId: values.get("--job-id")! }, {
    assertNoWorker, signal: controller.signal,
    exchange: (request, files, signal) => {
      console.log(JSON.stringify({ status: "waiting_for_cua_confirmation", ...files, expiresAt: request.expiresAt, sender: request.sender, recipient: request.recipientHandle }));
      return waitForAssistedAcknowledgement(request, files, signal);
    },
  });
  console.log(JSON.stringify({ status: result, note: result === "blocked"
    ? "Instagram recusou novas solicitações deste perfil. Tentativa bloqueada, sem confirmação de envio e sem repetição. Filas pausadas."
    : "Confira o painel e as pausas. Nenhum outro job foi executado." }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha na operação assistida.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
