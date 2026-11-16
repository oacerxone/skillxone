'use client';

import { useState } from 'react';
import type { VerificationState } from '@skillxone/shared/constants';
import { AGENT_INFO, buildInstallPlan, isAgentId } from '@/lib/install';
import type { InstallMethod, InstallScope } from '@/lib/install';
import { CopyButton } from './copy-button';

interface Props {
  owner: string;
  repo: string;
  skillName: string;
  /** Skill folder inside the repository ('' at the root). */
  skillPath: string;
  hasDescription: boolean;
  specValid: boolean;
  /** Agent ids this skill is compatible with. */
  agents: string[];
  verificationState: VerificationState;
  /** Commit that was assessed. Present only for a verified version. */
  verifiedCommit?: string;
  repositoryUrl: string;
  securityHref: string;
  isFixture: boolean;
}

function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex overflow-hidden rounded-md border border-border-strong">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex-1 cursor-pointer border-r border-border-strong text-center text-[13px] leading-[30px] last:border-r-0 has-[:checked]:bg-bg-muted has-[:checked]:font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Command({ id, text }: { id: string; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre id={id} tabIndex={0} className="code-block min-w-0 flex-1">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} />
    </div>
  );
}

export function InstallPanel(props: Props) {
  const supported = props.agents.filter(isAgentId);
  const [agent, setAgent] = useState<string>(supported[0] ?? 'claude-code');
  const [scope, setScope] = useState<InstallScope>('project');
  const [method, setMethod] = useState<InstallMethod>('symlink');
  const [pin, setPin] = useState(true);

  const usePin = props.verifiedCommit !== undefined && pin;
  const plan = buildInstallPlan({
    owner: props.owner,
    repo: props.repo,
    skillPath: props.skillPath,
    skill: {
      name: props.skillName,
      hasDescription: props.hasDescription,
      specValid: props.specValid,
    },
    agent,
    scope,
    method,
    commitSha: usePin ? props.verifiedCommit : undefined,
  });

  return (
    <section id="install" aria-labelledby="install-heading" className="panel p-4">
      <h2 id="install-heading" className="text-[16px] font-semibold leading-6">
        Install
      </h2>

      {props.verificationState === 'FLAGGED' && (
        <p
          role="alert"
          className="mt-3 rounded-sm bg-flagged-bg px-3 py-2 text-[13px] text-flagged-fg"
        >
          This version has security findings.{' '}
          <a href={props.securityHref} className="font-medium underline">
            Read the report
          </a>{' '}
          before installing.
        </p>
      )}
      {props.verificationState === 'UNVERIFIED' && (
        <p className="mt-3 rounded-sm bg-unverified-bg px-3 py-2 text-[13px] text-unverified-fg">
          This version has not been assessed. Review the source before installing.
        </p>
      )}
      {props.isFixture && (
        <p className="mt-3 rounded-sm bg-warning-bg px-3 py-2 text-[13px] text-warning-fg">
          Development fixture: this repository does not exist, so the command below will not work.
        </p>
      )}

      {supported.length === 0 ? (
        <p className="mt-3 text-[13px] text-text-muted">
          No supported agent is listed for this skill, so no command is offered.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <Segmented
            legend="Agent"
            name="install-agent"
            value={agent}
            onChange={setAgent}
            options={supported.map((id) => ({ value: id, label: AGENT_INFO[id]?.label ?? id }))}
          />
          <Segmented
            legend="Scope"
            name="install-scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'project', label: 'This project' },
              { value: 'global', label: 'All projects' },
            ]}
          />
          <Segmented
            legend="Method"
            name="install-method"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'symlink', label: 'skills CLI' },
              { value: 'copy', label: 'CLI, copy' },
              { value: 'manual', label: 'Manual' },
            ]}
          />

          {props.verifiedCommit && (
            <label className="flex items-start gap-2 text-[13px] leading-5">
              <input
                type="checkbox"
                className="mt-1"
                checked={pin}
                onChange={(event) => setPin(event.target.checked)}
              />
              <span>
                Pin to the verified commit{' '}
                <code className="font-mono text-[12px]">{props.verifiedCommit.slice(0, 7)}</code>
                <span className="block text-text-muted">
                  Unpinned installs fetch the latest commit, which has not been assessed.
                </span>
              </span>
            </label>
          )}

          {plan.ok ? (
            <>
              {plan.install ? (
                <div>
                  <p className="label" id="install-command-label">
                    Run in your {scope === 'project' ? 'project folder' : 'terminal'}
                  </p>
                  <Command id="install-command" text={plan.install} />
                  <p className="mt-2 text-[12px] leading-4 text-text-muted">
                    Installs to <code className="font-mono">{plan.targetDir}</code>
                    {method === 'copy' ? ' as an independent copy.' : ''}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="label">Install without the CLI</p>
                  <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-5">
                    {plan.steps.map((step) => (
                      <li key={step} className="break-words">
                        {step}
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-[13px]">
                    <a href={plan.sourceUrl} className="link" rel="noopener noreferrer">
                      Open the skill folder on GitHub
                    </a>
                  </p>
                </div>
              )}

              {plan.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-[12px] leading-4 text-text-muted">
                  {plan.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              <details className="text-[13px] leading-5">
                <summary className="cursor-pointer font-medium">Prerequisites</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-text-muted">
                  {plan.prerequisites.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
              {plan.update && (
                <details className="text-[13px] leading-5">
                  <summary className="cursor-pointer font-medium">Update</summary>
                  <div className="mt-2">
                    <Command id="update-command" text={plan.update} />
                  </div>
                </details>
              )}
              {plan.uninstall && (
                <details className="text-[13px] leading-5">
                  <summary className="cursor-pointer font-medium">Uninstall</summary>
                  <div className="mt-2">
                    <Command id="uninstall-command" text={plan.uninstall} />
                  </div>
                </details>
              )}
            </>
          ) : (
            <p className="rounded-sm bg-warning-bg px-3 py-2 text-[13px] text-warning-fg">
              {plan.reason} Install manually from the source repository.
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-[13px]">
        <a href={props.repositoryUrl} className="link" rel="noopener noreferrer">
          View source repository
        </a>
      </p>
    </section>
  );
}
