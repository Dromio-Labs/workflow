import type { EventRecord } from "../../core/loop/index.js";
import type { RuntimeSessionSnapshot } from "../../core/runtime/index.js";
import { createInteractionActions } from "./actions.js";
import { projectCandidateEvaluations } from "./candidate-evaluation.js";
import { projectEvaluationBars } from "./evaluation-bars.js";
import { mergeEvents } from "./events.js";
import type {
  CreateInteractionInput,
  Interaction,
} from "./interaction.types.js";
import { projectMessages } from "./messages.js";
import { createQuestionFlow } from "./question-flow.js";
import { projectQuestions } from "./questions.js";
import { projectQuestionResolutions } from "./resolution-feedback.js";
import { projectTimeline } from "./timeline.js";

export function createInteraction(input: CreateInteractionInput): Interaction {
  let session = input.session;
  let events = session.events;
  const questionFlow = createQuestionFlow({ client: input.client, session });
  const actions = createInteractionActions({
    client: input.client,
    getSession: () => session,
    onSession: setSession,
  });

  const interaction: Interaction = {
    actions,
    get candidateEvaluations() {
      return projectCandidateEvaluations(events);
    },
    get evaluationBars() {
      return projectEvaluationBars(events);
    },
    get messages() {
      return projectMessages(events);
    },
    get pendingHooks() {
      return session.pendingHooks;
    },
    get questionResolutions() {
      return projectQuestionResolutions(events);
    },
    questionFlow,
    get questions() {
      return projectQuestions(session).questions;
    },
    get session() {
      return session;
    },
    get status() {
      return session.status;
    },
    get timeline() {
      return projectTimeline(events);
    },
    async answer(questionId, value) {
      questionFlow.answer(questionId, value);
      if (questionFlow.questions.length === 1) {
        return questionFlow.submit().then(setSession);
      }
    },
    applyEvents(nextEvents) {
      events = mergeEvents(events, nextEvents);
      session = { ...session, events };
    },
    async refresh() {
      const next = await input.client.sessions.get(session.runId);
      await refreshActions(next);
      return setSession(next);
    },
    setCustomAnswer(questionId, value) {
      questionFlow.setCustomAnswer(questionId, value);
    },
    setText(questionId, value) {
      questionFlow.setText(questionId, value);
    },
    async *stream(streamInput = {}) {
      for await (const event of input.client.sessions.streamEvents(session.runId, streamInput)) {
        interaction.applyEvents([event]);
        yield event;
      }
    },
    submit() {
      return questionFlow.submit().then(setSession);
    },
    toggle(questionId, value) {
      questionFlow.toggle(questionId, value);
    },
  };

  void refreshActions(session);
  return interaction;

  function setSession(next: RuntimeSessionSnapshot) {
    session = next;
    events = mergeEvents(events, next.events);
    session = { ...session, events };
    questionFlow.updateSession(session);
    return session;
  }

  async function refreshActions(next: RuntimeSessionSnapshot) {
    actions.update(await input.client.sessions.actions(next.runId));
  }
}
