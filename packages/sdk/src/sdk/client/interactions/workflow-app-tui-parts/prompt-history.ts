export function createPromptHistoryState() {
  const items: string[] = [];
  let cursor: number | undefined;
  let draft = "";

  return {
    get cursor() {
      return cursor;
    },
    get draft() {
      return draft;
    },
    items,
    setCursor(value: number | undefined) {
      cursor = value;
    },
    setDraft(value: string) {
      draft = value;
    },
  };
}
