import {describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {SettingsShell} from "../../src/components/settings/SettingsShell";

const nav = [{
  id: "root",
  items: [
    {icon: "list", id: "workflows", label: "Workflows"},
    {icon: "commit", id: "runs", label: "Runs"},
  ],
}];

describe("SettingsShell", () => {
  it("renders nav, marks the active item, and selects on click", async () => {
    const onSelect = vi.fn();
    render(
      <SettingsShell activeItemId="workflows" contentTitle="Workflows" nav={nav} onSelect={onSelect}>
        <div>content body</div>
      </SettingsShell>,
    );
    expect(screen.getByRole("heading", {name: "Workflows"})).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Workflows"}).getAttribute("aria-current")).toBe("page");
    await userEvent.click(screen.getByRole("button", {name: "Runs"}));
    expect(onSelect).toHaveBeenCalledWith("runs");
    expect(screen.getByText("content body")).toBeInTheDocument();
  });

  it("shows the back affordance only when onBack is provided", () => {
    const {rerender} = render(
      <SettingsShell activeItemId="workflows" contentTitle="Workflows" nav={nav} onSelect={() => {}}>x</SettingsShell>,
    );
    expect(screen.queryByRole("button", {name: /Back to app/})).toBeNull();
    rerender(
      <SettingsShell activeItemId="workflows" contentTitle="Workflows" nav={nav} onBack={() => {}} onSelect={() => {}}>x</SettingsShell>,
    );
    expect(screen.getByRole("button", {name: /Back to app/})).toBeInTheDocument();
  });
});
