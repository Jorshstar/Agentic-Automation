import { ConfigurationError } from "../lib/errors.js";

/**
 * Agent registry — a phone book of agents.
 *
 * Code "registers" an agent under its name, then later "resolves" (looks up) an
 * agent by name. This is how we avoid wiring concrete agents directly into the
 * engine: the engine (or workflow builder) asks the registry for an agent
 * instead of constructing one with `new`. That indirection is what makes future
 * dependency injection, testing with fakes, and swapping providers painless.
 *
 * The registry only needs each agent to have a unique `name`, so it is generic
 * over the agent type — it works for both `BaseAgent` contracts and the newer
 * `AgentLifecycle` agents.
 */

/** The minimum an object needs to live in the registry: a unique name. */
export interface NamedAgent {
  readonly name: string;
}

export interface AgentRegistry<TAgent extends NamedAgent = NamedAgent> {
  /** Add an agent. */
  register(agent: TAgent): void;
  /** Look up an agent by name; throws if it is not registered. */
  resolve(name: string): TAgent;
  /** Whether an agent with this name is registered. */
  has(name: string): boolean;
  /** Names of all registered agents. */
  list(): readonly string[];
}

/**
 * A simple in-memory registry. This is plumbing, not an agent and not business
 * logic — it just stores agents in a Map.
 */
export class InMemoryAgentRegistry<TAgent extends NamedAgent = NamedAgent>
  implements AgentRegistry<TAgent>
{
  private readonly agents = new Map<string, TAgent>();

  register(agent: TAgent): void {
    if (this.agents.has(agent.name)) {
      throw new ConfigurationError(`Agent already registered: "${agent.name}"`);
    }
    this.agents.set(agent.name, agent);
  }

  resolve(name: string): TAgent {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new ConfigurationError(`No agent registered under name: "${name}"`);
    }
    return agent;
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  list(): readonly string[] {
    return [...this.agents.keys()];
  }
}
