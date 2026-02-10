/**
 * Agent registry -- manages agent profiles.
 */

import type { AgentProfile, AgentId } from '@coding-assistant/shared';
import { buildAgent } from './profiles/build.js';
import { planAgent } from './profiles/plan.js';
import { exploreAgent } from './profiles/explore.js';
import { summarizeAgent } from './profiles/summarize.js';
import { titleAgent } from './profiles/title.js';

export class AgentRegistry {
  private profiles = new Map<string, AgentProfile>();

  constructor() {
    // Register built-in profiles
    this.register(buildAgent);
    this.register(planAgent);
    this.register(exploreAgent);
    this.register(summarizeAgent);
    this.register(titleAgent);
  }

  register(profile: AgentProfile): void {
    this.profiles.set(profile.id, profile);
  }

  resolve(agentId: AgentId): AgentProfile {
    const profile = this.profiles.get(agentId);
    if (!profile) {
      throw new Error(`Agent profile not found: ${agentId}. Available: ${this.list().map(p => p.id).join(', ')}`);
    }
    return profile;
  }

  list(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  has(agentId: string): boolean {
    return this.profiles.has(agentId);
  }
}

export const agentRegistry = new AgentRegistry();
