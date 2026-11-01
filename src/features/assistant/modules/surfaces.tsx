"use client";

import { useAssistantModule } from "./activation";
import { envConfigModule } from "./env-config";
import { notebookModule } from "./notebook";
import { publishModule } from "./publish";

/** Optional UI for a prompt-only module: mounting it activates that fragment. */

export function NotebookAssistant() {
  useAssistantModule(notebookModule.id);
  return null;
}

export function PublishAssistant() {
  useAssistantModule(publishModule.id);
  return null;
}

export function EnvConfigAssistant() {
  useAssistantModule(envConfigModule.id);
  return null;
}
