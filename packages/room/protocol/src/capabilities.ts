import type { WorkflowViewCommand } from "./commands.js";

export type WorkflowViewCapabilities = {
  result: {
    json: boolean;
    jsonRender: boolean;
    markdown: boolean;
  };
  room: {
    appendMessage: boolean;
    recordDecision: boolean;
    resolveHand: boolean;
  };
  workflow: {
    answerQuestion: boolean;
    applyAction: boolean;
    pause: boolean;
    rerunFromCheckpoint: boolean;
    render: boolean;
    resumeHook: boolean;
  };
};

export type WorkflowViewCapabilityPath =
  | "result.json"
  | "result.jsonRender"
  | "result.markdown"
  | "room.appendMessage"
  | "room.recordDecision"
  | "room.resolveHand"
  | "workflow.answerQuestion"
  | "workflow.applyAction"
  | "workflow.pause"
  | "workflow.rerunFromCheckpoint"
  | "workflow.render"
  | "workflow.resumeHook";

export const workflowViewCapabilityPaths = [
  "result.json",
  "result.jsonRender",
  "result.markdown",
  "room.appendMessage",
  "room.recordDecision",
  "room.resolveHand",
  "workflow.answerQuestion",
  "workflow.applyAction",
  "workflow.pause",
  "workflow.rerunFromCheckpoint",
  "workflow.render",
  "workflow.resumeHook",
] as const satisfies readonly WorkflowViewCapabilityPath[];

export const readOnlyWorkflowViewCapabilities: WorkflowViewCapabilities = {
  result: {
    json: true,
    jsonRender: false,
    markdown: true,
  },
  room: {
    appendMessage: false,
    recordDecision: false,
    resolveHand: false,
  },
  workflow: {
    answerQuestion: false,
    applyAction: false,
    pause: false,
    rerunFromCheckpoint: false,
    render: true,
    resumeHook: false,
  },
};

export const interactiveWorkflowViewCapabilities: WorkflowViewCapabilities = {
  result: {
    json: true,
    jsonRender: true,
    markdown: true,
  },
  room: {
    appendMessage: true,
    recordDecision: true,
    resolveHand: true,
  },
  workflow: {
    answerQuestion: true,
    applyAction: true,
    pause: true,
    rerunFromCheckpoint: true,
    render: true,
    resumeHook: true,
  },
};

export function workflowViewCommandCapabilityPath(
  command: WorkflowViewCommand,
): WorkflowViewCapabilityPath {
  switch (command.type) {
    case "workflow.hook.resume":
      return "workflow.resumeHook";
    case "workflow.question.answer":
      return "workflow.answerQuestion";
    case "workflow.action.apply":
      return "workflow.applyAction";
    case "workflow.session.pause":
      return "workflow.pause";
    case "workflow.checkpoint.rerun":
      return "workflow.rerunFromCheckpoint";
    case "room.appendMessage":
      return "room.appendMessage";
    case "room.recordDecision":
      return "room.recordDecision";
    case "room.resolveHand":
      return "room.resolveHand";
  }
}

export function workflowViewCapabilitiesAllowCommand(
  capabilities: WorkflowViewCapabilities,
  command: WorkflowViewCommand,
): boolean {
  return capabilityEnabled(capabilities, workflowViewCommandCapabilityPath(command));
}

export function capabilityEnabled(
  capabilities: WorkflowViewCapabilities,
  path: WorkflowViewCapabilityPath,
): boolean {
  switch (path) {
    case "result.json":
      return capabilities.result.json;
    case "result.jsonRender":
      return capabilities.result.jsonRender;
    case "result.markdown":
      return capabilities.result.markdown;
    case "room.appendMessage":
      return capabilities.room.appendMessage;
    case "room.recordDecision":
      return capabilities.room.recordDecision;
    case "room.resolveHand":
      return capabilities.room.resolveHand;
    case "workflow.answerQuestion":
      return capabilities.workflow.answerQuestion;
    case "workflow.applyAction":
      return capabilities.workflow.applyAction;
    case "workflow.pause":
      return capabilities.workflow.pause;
    case "workflow.rerunFromCheckpoint":
      return capabilities.workflow.rerunFromCheckpoint;
    case "workflow.render":
      return capabilities.workflow.render;
    case "workflow.resumeHook":
      return capabilities.workflow.resumeHook;
  }
}
