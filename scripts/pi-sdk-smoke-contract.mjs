export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
export const PROBE_TIMEOUT_MS = 15_000;
export const UNHANDLED_ERROR_PATTERN = /Unhandled(?:Promise)?Rejection|unhandled rejection|uncaught(?:Exception| exception| error)|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /(?:failed to (?:load|import)|error (?:loading|importing)) extension/i;

export function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function responseFor(responses, id, command) {
  return responses.find((row) => row?.type === "response" && row.id === id && row.command === command);
}

function registration(responses) {
  const result = responseFor(responses, "commands", "get_commands");
  const commands = result?.data?.commands;
  const registered = Array.isArray(commands)
    ? commands.find((item) => item?.name === "vault-guard:status" && item?.source === "extension")
    : undefined;
  return {
    response: result ? { success: result.success, command: result.command } : null,
    command: registered ? { name: registered.name, source: registered.source } : null,
  };
}

function handledStatus(responses, output, vaultRoot, severity, message) {
  const prompt = responseFor(responses, "feature", "prompt");
  const notification = responses.find((row) => row?.type === "extension_ui_request"
    && row.method === "notify" && row.message === "Vault Guard status collected");
  const expectedStatus = output.includes(`vault root: ${vaultRoot}`)
    && output.includes(`severity: ${severity}`)
    && output.includes(`message: ${message}`);
  const statusLines = output.split(/\r?\n/)
    .filter((line) => /^\s*(Vault Guard status|vault root:|severity:|branch:|message:)/.test(line))
    .map((line) => line.replace(/(vault root:\s*).+$/, "$1<fixture>"));
  return {
    prompt: prompt ?? null,
    notification: notification ?? null,
    statusLines,
    passed: prompt?.success === true && prompt.data?.disposition === "handled"
      && !!notification && expectedStatus,
  };
}

export function behaviorAssertions(name, {
  responses = [],
  fullOutput = "",
  exit_code = -1,
  expectedVersion,
  vaultRoot,
  nonGitRoot,
  secondProcess,
}) {
  if (name === "extension_load") {
    const observed = registration(responses);
    return [assertion(
      "extension_registered",
      "The actual Pi host lists vault-guard:status as a registered extension command",
      observed,
      observed.response?.success === true && observed.command !== null,
    )];
  }

  if (name === "happy_path") {
    const observed = handledStatus(responses, fullOutput, vaultRoot, "ok", "vault is clean");
    return [assertion(
      "feature_response",
      "The actual Pi host handles /vault-guard:status and reports the clean git vault",
      observed,
      observed.passed,
    )];
  }

  if (name === "error_path") {
    const observed = handledStatus(
      responses,
      fullOutput,
      nonGitRoot,
      "warn",
      "vault root is not a git repository",
    );
    const parseError = responses.find((row) => row?.type === "response" && row.command === "parse");
    const result = { feature: observed, parseError: parseError ?? null };
    return [assertion(
      "handled_error",
      "A non-git vault returns a handled warning and malformed RPC input returns an explicit parse failure",
      result,
      observed.passed && parseError?.success === false
        && typeof parseError.error === "string" && parseError.error.length > 0,
    )];
  }

  if (name === "reload_cleanup") {
    const second = secondProcess ?? { responses: [], fullOutput: "", exit_code: -1 };
    const loaded = registration(second.responses);
    const feature = handledStatus(second.responses, second.fullOutput, vaultRoot, "ok", "vault is clean");
    return [
      assertion(
        "reloaded_extension_registered",
        "A second actual Pi process registers vault-guard:status after the first process exits",
        loaded,
        loaded.response?.success === true && loaded.command !== null,
      ),
      assertion(
        "reloaded_feature_response",
        "The second Pi process handles the status command and returns the clean-vault response",
        feature,
        feature.passed,
      ),
      assertion(
        "clean_shutdown",
        "Both Pi processes exit zero without unhandled or shutdown errors after stdin closes",
        {
          first_exit_code: exit_code,
          second_exit_code: second.exit_code,
          first_errors: UNHANDLED_ERROR_PATTERN.test(fullOutput),
          second_errors: UNHANDLED_ERROR_PATTERN.test(second.fullOutput),
        },
        exit_code === 0 && second.exit_code === 0
          && !UNHANDLED_ERROR_PATTERN.test(fullOutput)
          && !UNHANDLED_ERROR_PATTERN.test(second.fullOutput),
      ),
    ];
  }

  if (name === "host_shell") {
    return [assertion(
      "native_shell_boundary",
      "The native host shell launches the locally pinned Pi CLI and returns its exact version",
      { exit_code, output: fullOutput.trim(), expectedVersion },
      exit_code === 0 && fullOutput.trim() === expectedVersion,
    )];
  }

  throw new Error(`Unknown smoke case: ${name}`);
}
