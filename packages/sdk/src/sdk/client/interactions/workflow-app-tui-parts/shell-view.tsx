/** @jsxImportSource @opentui/solid */
import { QuestionDock } from "../opentui-workflow-renderer.impl.js";
import { CommandPalette, SlashCommandMenu, WorkflowExportWizardDialog } from "./command-palette.js";
import { WorkflowDiagramPopup } from "./diagram-view.js";
import { ConfigValueEditorDialog, PromptFileViewerDialog, ResultArtifactPopup, ShellDialogView, ShellToastView, StepInspectorPopup, toastLeft, toastWidth } from "./dialogs-popups.js";
import { HookDock, InteractionDock, StatusBar } from "./dock-status.js";
import { WorkflowSessionListDialog } from "./session-dialog.js";
import { ShellHeader, ShellMain } from "./shell-frame.js";
import { WorkflowSidebar } from "./sidebar.js";
import { StartMetadataPopup } from "./start-metadata-panel.js";
import { LAYOUT, THEME } from "./style.js";
import { Show } from "solid-js";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellViewContext = WorkflowAppTuiShellContext;

export function WorkflowAppTuiShellView(viewProps: { ctx: WorkflowAppTuiShellViewContext }) {
  const { activeRunHeaderMeta, appListings, artifacts, commandIndex, commandName, commandOpen, commandQuery, commands, configOverridesByWorkflow, configValueEditor, copySelectionToClipboard, detailCollapsedStepIds, dialog, dimensions, error, expandedStartStepIds, filteredCommands, filteredSlashCommands, filteredWorkflows, hookRun, hookValue, lastViewedRunId, leaderActive, libraryDiagramOpen, libraryViewMode, metadataPopupOpen, navigateStart, navigateTriggerFire, openActivityContentViewer, openConfigValueEditor, openPromptFileViewer, openResultPopup, openStepRuntimeDataViewer, prompt, promptAttachments, promptCursor, promptFileViewer, promptFileViewerScrollOffset, props, questionActive, questionController, refreshTriggerRuntime, result, resultPopup, resultPopupScrollOffset, route, scrollPromptFileViewer, scrollWorkflowSessions, selectJobIndex, selectStartDiagramStepId, selectTriggerIndex, selectWorkflow, selectedInputFieldIndex, selectedMetadataPromptRowIndex, selectedSidebarTab, selectedStartCenterTab, selectedStartInputMode, selectedStartOutlineItem, selectedStartPane, selectedStartStepId, selectedStartTriggerSummary, selectedTrigger, selectedTriggerJob, selectedWorkflow, selectedWorkflowId, selectedWorkspaceFrame, sessionListDialog, setMetadataPopupOpen, setSelectedMetadataPromptRowIndex, setSelectedSidebarTab, setSelectedStartCenterTab, showSidebar, showStartDiagramPane, slashIndex, slashOpen, slashQuery, snapshot, spinnerFrame, startInputForm, status, stepInspectorPopup, stepInspectorPopupScrollOffset, stepInspectorPopupSelectedLineIndex, toast, toggleDetailStepCollapsed, toggleWorkflowExportSelection, triggerJobs, triggers, viewStep, viewedRun, viewedRunOrigin, visibleQuestionActive, visibleStartInputForm, workflowExportFields, workflowExportMode, workflowExportSelection, workflowExportWizard, workflowIds, workflowQuery, workflowRoomVisible, workflowViewProtocolMode, workflowViewSnapshot, workflows } = viewProps.ctx();
  return (
    <box
      backgroundColor={THEME.background}
      flexDirection="column"
      height={dimensions().height}
      onMouseUp={copySelectionToClipboard}
      paddingBottom={LAYOUT.shellPaddingBottom}
      paddingLeft={LAYOUT.shellPaddingLeft}
      paddingRight={LAYOUT.shellPaddingRight}
      paddingTop={LAYOUT.shellPaddingTop}
      width={dimensions().width}
    >
      <ShellHeader
        appTitle={props.app.title}
        commandName={commandName}
        compact={dimensions().height < 18}
        leaderActive={leaderActive()}
        runMeta={activeRunHeaderMeta()}
        route={route()}
        status={status()}
        workflow={selectedWorkflow()}
        workflowCount={workflowIds().length}
      />
      <box flexDirection="row" flexGrow={1} gap={LAYOUT.gutter} minHeight={0} overflow="hidden">
        <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
          <ShellMain
            app={props.app}
            appListings={appListings()}
            artifacts={artifacts()}
            configOverridesByWorkflow={configOverridesByWorkflow()}
            detailCollapsedStepIds={detailCollapsedStepIds()}
            error={error()}
            expandedStartStepIds={expandedStartStepIds()}
            libraryExportMode={workflowExportMode()}
            libraryExportSelection={workflowExportSelection()}
            libraryViewMode={libraryViewMode()}
            inputDraft={prompt()}
            result={result()}
            runOrigin={viewedRun()?.origin ?? viewedRunOrigin()}
            route={route()}
            selectedJob={selectedTriggerJob()}
            selectedStartCenterTab={selectedStartCenterTab()}
            selectedStartPane={selectedStartPane()}
            selectedStartStepId={selectedStartStepId()}
            selectedTrigger={selectedTrigger()}
            selectedWorkflowId={selectedWorkflowId()}
            workflowViewProtocolMode={workflowViewProtocolMode()}
            workflowRoomVisible={workflowRoomVisible()}
            workflowViewSnapshot={workflowViewSnapshot?.()}
            snapshot={snapshot()}
            showDiagramPane={showStartDiagramPane()}
            spinnerFrame={spinnerFrame()}
            status={status()}
            terminalHeight={dimensions().height}
            terminalWidth={dimensions().width}
            triggerJobs={triggerJobs()}
            triggers={triggers()}
            workspaceFrame={selectedWorkspaceFrame()}
            workflows={filteredWorkflows()}
            onEditConfigValue={openConfigValueEditor}
            onOpenActivityContent={openActivityContentViewer}
            onOpenMetadataPopup={() => setMetadataPopupOpen(true)}
            onOpenPromptFile={openPromptFileViewer}
            onOpenStepData={openStepRuntimeDataViewer}
            selectedMetadataPromptRowIndex={selectedMetadataPromptRowIndex()}
            onSelectStartStep={selectStartDiagramStepId}
            onSelectWorkflow={selectWorkflow}
            onFireTrigger={navigateTriggerFire}
            onRefreshTriggers={refreshTriggerRuntime}
            onSelectJob={(jobId) => {
              const index = triggerJobs().findIndex((job: any) => job.id === jobId);
              if (index >= 0) selectJobIndex(index);
            }}
            onSelectStartCenterTab={setSelectedStartCenterTab}
            onSelectStep={viewStep}
            onToggleDetailStepCollapsed={toggleDetailStepCollapsed}
            onToggleWorkflowExportSelection={toggleWorkflowExportSelection}
            onOpenResult={() => openResultPopup(undefined)}
            onSelectTrigger={(triggerId) => {
              const index = triggers().findIndex((trigger: any) => trigger.id === triggerId);
              if (index >= 0) selectTriggerIndex(index);
            }}
            onStartWorkflow={navigateStart}
          />
        </box>
        <Show when={showSidebar()}>
          <WorkflowSidebar
            app={props.app}
            artifacts={artifacts()}
            result={result()}
            runOrigin={viewedRun()?.origin ?? viewedRunOrigin()}
            route={route()}
            selectedTab={selectedSidebarTab()}
            snapshot={snapshot()}
            spinnerFrame={spinnerFrame()}
            status={status()}
            triggerJobCount={triggerJobs().length}
            triggerCount={triggers().length}
            workspaceFrame={selectedWorkspaceFrame()}
            workflow={selectedWorkflow()}
            workflowCount={workflowIds().length}
            onSelectArtifact={openResultPopup}
            onSelectTab={setSelectedSidebarTab}
          />
        </Show>
      </box>
      <Show
        when={visibleQuestionActive()}
        fallback={
          <Show
            when={hookRun()}
            fallback={
              <InteractionDock
                attachments={promptAttachments()}
                canRenderInputForm={Boolean(startInputForm())}
                compact={dimensions().height < 18}
                inputForm={visibleStartInputForm()}
                inputMode={selectedStartInputMode()}
                prompt={prompt}
                promptCursor={promptCursor()}
                route={route}
                selectedInputFieldIndex={selectedInputFieldIndex()}
                selectedStartPane={selectedStartPane()}
                status={status}
                workflow={selectedWorkflow}
                workflowQuery={workflowQuery}
              />
            }
          >
            {(run) => <HookDock run={run()} value={hookValue()} />}
          </Show>
        }
      >
        <QuestionDock
          controller={questionController}
          keyboardDisabled={() => commandOpen() || slashOpen() || leaderActive()}
          snapshot={snapshot()}
        />
      </Show>
      <StatusBar
        commandName={commandName}
        compact={dimensions().height < 18}
        leaderActive={leaderActive()}
        route={route()}
        status={status()}
        workflow={selectedWorkflow()}
      />
      <Show when={libraryDiagramOpen() && route().type === "library"}>
        <WorkflowDiagramPopup
          graph={props.app.graph(selectedWorkflowId())}
          terminalHeight={dimensions().height}
          terminalWidth={dimensions().width}
          workflow={selectedWorkflow()}
        />
      </Show>
      <Show when={commandOpen()}>
        <CommandPalette
          commands={filteredCommands()}
          index={commandIndex()}
          query={commandQuery()}
          viewportHeight={dimensions().height}
          viewportWidth={dimensions().width}
        />
      </Show>
      <Show when={slashOpen()}>
        <SlashCommandMenu
          commands={filteredSlashCommands()}
          index={slashIndex()}
          query={slashQuery()}
          viewportHeight={dimensions().height}
          viewportWidth={dimensions().width}
        />
      </Show>
      <Show when={workflowExportWizard()}>
        {(wizard) => (
          <WorkflowExportWizardDialog
            fields={workflowExportFields()}
            selectedWorkflowCount={workflowExportSelection().size}
            state={wizard()}
            terminalHeight={dimensions().height}
            terminalWidth={dimensions().width}
            workflows={workflows()}
            workflowIds={[...workflowExportSelection()]}
          />
        )}
      </Show>
      <Show when={dialog()}>
        {(current) => <ShellDialogView dialog={current()} />}
      </Show>
      <Show when={configValueEditor()}>
        {(editor) => (
          <ConfigValueEditorDialog
            editor={editor()}
            terminalWidth={dimensions().width}
          />
        )}
      </Show>
      <Show when={sessionListDialog()}>
        {(state) => (
          <WorkflowSessionListDialog
            currentRunId={lastViewedRunId()}
            selectedWorkflowTitle={selectedWorkflow().title}
            state={state()}
            terminalHeight={dimensions().height}
            terminalWidth={dimensions().width}
            onScroll={scrollWorkflowSessions}
          />
        )}
      </Show>
      <Show when={metadataPopupOpen()}>
        <StartMetadataPopup
          configOverrides={configOverridesByWorkflow()[selectedWorkflowId()] ?? {}}
          inputDraft={prompt()}
          selectedStep={selectedStartOutlineItem()?.node}
          selectedMetadataRowIndex={selectedMetadataPromptRowIndex()}
          selectedTriggerSummary={selectedStartTriggerSummary()}
          terminalHeight={dimensions().height}
          terminalWidth={dimensions().width}
          workflowViewProtocolMode={workflowViewProtocolMode()}
          workflowViewSnapshot={workflowViewSnapshot?.()}
          workflow={selectedWorkflow()}
          workspaceFrame={selectedWorkspaceFrame()}
          onEditConfigValue={openConfigValueEditor}
          onOpenPromptFile={openPromptFileViewer}
          onSelectMetadataRow={setSelectedMetadataPromptRowIndex}
        />
      </Show>
      <Show when={stepInspectorPopup()}>
        {(popup) => (
          <StepInspectorPopup
            popup={popup()}
            scrollOffset={stepInspectorPopupScrollOffset()}
            selectedLineIndex={stepInspectorPopupSelectedLineIndex()}
            terminalHeight={dimensions().height}
            terminalWidth={dimensions().width}
          />
        )}
      </Show>
      <Show when={promptFileViewer()}>
        {(viewer) => (
          <PromptFileViewerDialog
            scrollOffset={promptFileViewerScrollOffset()}
            terminalHeight={dimensions().height}
            terminalWidth={dimensions().width}
            viewer={viewer()}
            onScroll={scrollPromptFileViewer}
          />
        )}
      </Show>
      <Show when={resultPopup()}>
        {(popup) => (
          <ResultArtifactPopup
            popup={popup()}
            scrollOffset={resultPopupScrollOffset()}
            terminalHeight={dimensions().height}
            terminalWidth={dimensions().width}
          />
        )}
      </Show>
      <Show when={toast()}>
        {(current) => (
          <ShellToastView
            left={toastLeft(dimensions().width)}
            toast={current()}
            width={toastWidth(dimensions().width)}
          />
        )}
      </Show>
    </box>
  );
}
