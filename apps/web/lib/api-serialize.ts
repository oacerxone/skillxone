import type { SkillDetail, SkillListItem, SkillPage } from '@skillxone/database';

/**
 * Public JSON shapes. Fields are picked explicitly so nothing internal (scanner logs,
 * reviewer ids, ETags) can leak by being added to a database row later.
 */

const SITE = () => (process.env.SITE_URL ?? '').replace(/\/$/, '');

export function serializeSkill(item: SkillListItem) {
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    description: item.description,
    repository: {
      owner: item.owner,
      name: item.repo,
      stars: item.stars,
      archived: item.repositoryArchived,
    },
    license: item.license,
    agents: item.agents,
    verification: item.verificationState,
    lifecycle: item.lifecycleState,
    quality: item.quality === null ? null : Math.round(item.quality * 1000) / 1000,
    updatedAt: item.updatedAt,
    firstIndexedAt: item.firstIndexedAt,
    url: `${SITE()}/skills/${item.slug}`,
  };
}

export function serializePage(page: SkillPage) {
  return {
    data: page.items.map(serializeSkill),
    pagination: {
      page: page.page,
      perPage: page.pageSize,
      total: page.total,
      pages: page.pageCount,
    },
  };
}

export function serializeVersions(skill: SkillDetail) {
  return skill.versions.map((version) => ({
    id: version.id,
    commitSha: version.commitSha,
    contentHash: version.contentHash,
    indexedAt: version.indexedAt,
    fileCount: version.fileCount,
    totalBytes: version.totalBytes,
    current: version.isCurrent,
  }));
}

export function serializeSecurity(skill: SkillDetail) {
  const report = skill.report;
  return {
    skillId: skill.id,
    verification: skill.verificationState,
    lifecycle: skill.lifecycleState,
    expiresAt: skill.verification?.expires_at ?? null,
    decision: skill.verification
      ? {
          reason: skill.verification.reason,
          summary: skill.verification.note,
          decidedAt: skill.verification.valid_from,
        }
      : null,
    report: report
      ? {
          commitSha: report.scan.commit_sha,
          contentHash: report.scan.content_hash,
          status: report.scan.status,
          error: report.scan.error,
          scannedAt: report.scan.finished_at,
          scannerVersion: report.scan.scanner_version,
          policyVersion: report.scan.policy_version,
          outcome: report.scan.outcome,
          checksRun: report.checksRun,
          checksSkipped: report.checksSkipped,
          findings: report.findings.map((finding) => ({
            id: finding.id,
            ruleId: finding.rule_id,
            category: finding.category,
            severity: finding.severity,
            file: finding.file_path,
            lineStart: finding.line_start,
            lineEnd: finding.line_end,
            excerpt: finding.excerpt,
            explanation: finding.explanation,
            remediation: finding.remediation,
            status: finding.status,
            reviewNote: finding.review_note,
          })),
        }
      : null,
  };
}

export function serializeSkillDetail(skill: SkillDetail) {
  return {
    ...serializeSkill(skill),
    path: skill.path,
    repository: {
      id: skill.repository.id,
      owner: skill.owner,
      name: skill.repo,
      stars: skill.stars,
      forks: skill.repository.forks,
      archived: skill.repositoryArchived,
      pushedAt: skill.repository.pushedAt,
      license: skill.repository.license,
    },
    categories: skill.categories,
    compatibility: skill.compatibility,
    currentVersion: skill.currentVersion
      ? {
          commitSha: skill.currentVersion.commitSha,
          contentHash: skill.currentVersion.contentHash,
          indexedAt: skill.currentVersion.indexedAt,
        }
      : null,
    files: skill.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      sizeBytes: file.size_bytes,
      executable: file.is_executable === 1,
    })),
    ranking: skill.ranking
      ? {
          computedAt: skill.ranking.computedAt,
          signals: skill.ranking.signals,
          adjustments: skill.ranking.adjustments,
        }
      : null,
  };
}
