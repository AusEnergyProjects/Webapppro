"use client";
import type { User } from 'firebase/auth';
import dynamic from 'next/dynamic';
import { TradeTasksWorkspace } from './TradeTasksWorkspace';
import styles from './TradeTasksWorkspace.module.css';
const TradeTrainingWorkspace = dynamic(() => import('./TradeTrainingWorkspace').then(module => module.TradeTrainingWorkspace), { loading: () => <p role="status">Loading your training...</p> });

export function TradeTasksAndTraining({ user, tab, onTab }: { user: User; tab: 'tasks' | 'training'; onTab: (tab: 'tasks' | 'training') => void }) {
  return <section><nav className={styles.tabs} aria-label="Tasks and training"><button type="button" aria-pressed={tab === 'tasks'} onClick={() => onTab('tasks')}>Tasks</button><button type="button" aria-pressed={tab === 'training'} onClick={() => onTab('training')}>My training</button></nav>{tab === 'tasks' ? <TradeTasksWorkspace user={user} /> : <TradeTrainingWorkspace user={user} />}</section>;
}
