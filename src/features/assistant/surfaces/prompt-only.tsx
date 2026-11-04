"use client";

import { useAssistantModule } from "../modules/activation";
import { envConfigModule } from "../modules/env-config";
import { publishModule } from "../modules/publish";

/** Prompt-only surfaces: mounting one activates its fragment. They register no tools. */

export function PublishAssistant() {
  useAssistantModule(publishModule.id);
  return null;
}

export function EnvConfigAssistant() {
  useAssistantModule(envConfigModule.id);
  return null;
}
