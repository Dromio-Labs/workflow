import type {
	ChatShellMenu,
	ChatShellMenuItem,
} from "../../contracts/chatShellManifest";

export function taskMenuForPinState(
	menu: ChatShellMenu,
	pinned: boolean,
): ChatShellMenu {
	if (!pinned) return menu;
	return {
		...menu,
		sections: menu.sections.map((section) => ({
			...section,
			items: section.items.map((item) => taskMenuItemForPinState(item, true)),
		})),
	};
}

export function taskMenuItemForPinState(
	item: ChatShellMenuItem,
	pinned: boolean,
): ChatShellMenuItem {
	if (!pinned || item.icon !== "pin") return item;
	return { ...item, label: item.label.replace(/^Pin\b/, "Unpin") };
}
