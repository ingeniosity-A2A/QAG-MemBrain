export function parseGovernanceVersion(content: string): string {
  const versionMatch = content.match(/-\s*Version:\s*([^\n\r]+)/);
  if (!versionMatch) {
    throw new Error("Governance version not found in runtime governance document");
  }

  const version = versionMatch[1].trim();
  if (version.length === 0) {
    throw new Error("Governance version is empty in runtime governance document");
  }

  return version;
}