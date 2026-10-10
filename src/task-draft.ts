type TaskSource = {
  title: string; notes: string; estimatedHours?: number | null;
  mode?: 'deadline' | 'ongoing' | 'note'; due: string; recurrence: string;
  every: number; unit: string; leadMinutes: number; repeatMinutes: number;
  windows: boolean; discord: boolean;
};

export function duplicateTask(source: TaskSource) {
  const mode = source.mode ?? 'deadline';
  // Copy only editable fields, never identity, completion or remote-row state.
  return {
    kind: 'task' as const, title: source.title, notes: source.notes, mode,
    estimatedHours: source.estimatedHours ?? null, actualHours: null,
    amount: 0, currency: 'IDR', enabled: true, completed: false,
    syncToSheets: false,
    due: mode === 'note' ? '' : source.due,
    recurrence: mode === 'ongoing' ? source.recurrence : 'once',
    every: mode === 'ongoing' ? source.every : 1,
    unit: mode === 'ongoing' ? source.unit : 'days',
    leadMinutes: mode === 'deadline' ? source.leadMinutes : 0,
    repeatMinutes: mode === 'note' ? 0 : source.repeatMinutes,
    windows: mode === 'note' ? false : source.windows,
    discord: mode === 'note' ? false : source.discord,
  };
}
