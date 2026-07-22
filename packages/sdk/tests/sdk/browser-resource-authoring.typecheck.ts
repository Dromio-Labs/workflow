import type { DromioBrowserCapabilitySpec } from "@dromio/workflow/config";

type BrowserResourceSettings = NonNullable<DromioBrowserCapabilitySpec["resources"]>;
type Assert<T extends true> = T;
type Exactly<Actual, Expected> =
  [Actual] extends [Expected]
    ? [Expected] extends [Actual]
      ? true
      : false
    : false;

type CallerOwnedResourceKeys = "databasePath" | "profileNamespace";

type _OnlyCallerOwnedResourceKeys = Assert<
  Exactly<keyof BrowserResourceSettings, CallerOwnedResourceKeys>
>;
type _ApplicationIdIsRuntimeOwned = Assert<
  Exactly<"applicationId" extends keyof BrowserResourceSettings ? true : false, false>
>;
type _TenantIdIsRuntimeOwned = Assert<
  Exactly<"tenantId" extends keyof BrowserResourceSettings ? true : false, false>
>;
type _UserIdIsRuntimeOwned = Assert<
  Exactly<"userId" extends keyof BrowserResourceSettings ? true : false, false>
>;
type _ProfileResourceIdIsRuntimeOwned = Assert<
  Exactly<"profileResourceId" extends keyof BrowserResourceSettings ? true : false, false>
>;

const authoredResources = {
  databasePath: ".dromio/browser/resources.sqlite",
  profileNamespace: "browser-agent",
} satisfies BrowserResourceSettings;

void authoredResources;
