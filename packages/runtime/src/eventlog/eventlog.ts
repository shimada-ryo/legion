import type { Database } from 'bun:sqlite'
import type { AgentEvent } from '@legion/core'
import { EventLogReader, type HistoryOptions } from './reader'
import { EventLogWriter } from './writer'

export class EventLog {
  private writer: EventLogWriter
  private reader: EventLogReader

  constructor(db: Database) {
    this.writer = new EventLogWriter(db)
    this.reader = new EventLogReader(db)
  }

  append(workflowInstanceId: string, evt: AgentEvent): number {
    const seq = this.writer.append(workflowInstanceId, evt)
    this.reader.notify(workflowInstanceId, evt, seq)
    return seq
  }

  history(workflowInstanceId: string, opts?: HistoryOptions): AgentEvent[] {
    return this.reader.history(workflowInstanceId, opts)
  }

  tail(
    workflowInstanceId: string,
    handler: (e: AgentEvent, seq: number) => void,
  ): () => void {
    return this.reader.tail(workflowInstanceId, handler)
  }
}
