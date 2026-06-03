export interface VerificationReport {
  trusted: boolean;
  artifactPath: string;
  authority: string;
  authorityValid: boolean;
  keyRegistered: boolean;
  signatureValid: boolean;
  governanceValid: boolean;
  buildValid: boolean;
  deploymentValid: boolean;
  runtimeValid: boolean;
  replayValid: boolean;
  proofValid: boolean;
  issues: string[];
}

export function renderVerificationReport(report: VerificationReport): string {
  const lines: string[] = [];

  lines.push(`Artifact: ${report.artifactPath}`);
  lines.push("");
  lines.push("Authority");
  lines.push(`  ${mark(report.authorityValid)} authorityId valid (${report.authority})`);
  lines.push(`    ${mark(report.keyRegistered)} key registered`);
  lines.push(`      ${mark(report.signatureValid)} signature valid`);
  lines.push("");
  lines.push("Governance");
  lines.push(`  ${mark(report.governanceValid)} governance valid`);
  lines.push("");
  lines.push("Build");
  lines.push(`  ${mark(report.buildValid)} build manifest valid`);
  lines.push("");
  lines.push("Deployment");
  lines.push(`  ${mark(report.deploymentValid)} deployment manifest valid`);
  lines.push("");
  lines.push("Runtime");
  lines.push(`  ${mark(report.runtimeValid)} runtime hash valid`);
  lines.push("");
  lines.push("Replay");
  lines.push(`  ${mark(report.replayValid)} replay hash valid`);
  lines.push(`    ${mark(report.proofValid)} proof valid`);
  lines.push("");
  lines.push("Result");
  lines.push(`  ${report.trusted ? "TRUSTED" : "UNTRUSTED"}`);

  if (report.issues.length > 0) {
    lines.push("");
    lines.push("Issues");
    for (const issue of report.issues) {
      lines.push(`  - ${issue}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function mark(value: boolean): string {
  return value ? "✓" : "✗";
}
