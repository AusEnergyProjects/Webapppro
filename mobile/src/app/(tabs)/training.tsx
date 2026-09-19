import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { API_BASE_URL } from '@/lib/config';
import { colours, radius, spacing } from '@/lib/theme';
import { loadTrainingOverview, startTrainingAssessment, submitTrainingAssessment, checkTrainingAnswer, type TrainingAnswerFeedback, type TrainingAttempt, type TrainingModule, type TrainingOverview, type TrainingResult, type TrainingSource } from '@/lib/training';
import { useApp } from '@/providers/app-provider';

const readable = (value: string) => value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const date = (value: string) => new Date(value).toLocaleDateString('en-AU');
const learnerSource = (source: TrainingSource) => source.id !== 'creditex-review' && !source.url.includes('creditex-source-review.md');
const learningStatus = (status: string) => ['awaiting_review', 'unavailable'].includes(status) ? 'Assessment unavailable' : readable(status);
const assessmentReason = (module: TrainingModule) => module.assessmentUnavailableReason || 'Assessment is unavailable. Refresh the module status for the current requirements.';

export default function TrainingScreen() {
  const { user, sync } = useApp();
  if (!user) return <Screen><Text style={styles.body}>Sign in to view your training.</Text></Screen>;
  return <TrainingWorkspace key={user.localOwnerKey} online={sync.online} />;
}

function TrainingWorkspace({ online }: { online: boolean }) {
  const [data, setData] = useState<TrainingOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('load');
  const [search, setSearch] = useState('');
  const [program, setProgram] = useState('');
  const [visible, setVisible] = useState(12);
  const [selected, setSelected] = useState<TrainingModule | null>(null);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [readLessons, setReadLessons] = useState<number[]>([]);
  const [attempt, setAttempt] = useState<TrainingAttempt | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TrainingResult | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [answerFeedback, setAnswerFeedback] = useState<Record<string, TrainingAnswerFeedback>>({});

  const refresh = useCallback(async () => {
    setBusy('load'); setError('');
    try { setData(await loadTrainingOverview()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Training could not be loaded. Reconnect and try again.'); }
    finally { setBusy(''); }
  }, []);
  useEffect(() => {
    let active = true;
    void loadTrainingOverview().then(value => { if (active) setData(value); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Training could not be loaded.'); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
    // Network changes must not erase an assessment in progress. The Refresh button reloads status.
  }, []);

  function openModule(module: TrainingModule) {
    setSelected(module); setLessonIndex(0); setReadLessons([]); setAttempt(null); setAnswers({}); setAnswerFeedback({}); setResult(null); setShowFeedback(false); setError('');
  }
  async function openSource(source: TrainingSource) {
    try {
      const url = new URL(source.url, API_BASE_URL);
      if (url.protocol !== 'https:') throw new Error('This source link is unavailable. Ask Creditex to review it.');
      await Linking.openURL(url.href);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The source could not be opened.'); }
  }
  async function start() {
    if (!selected || !allRead || !selected.assessmentAvailable || selected.status === 'passed' || !online || busy) return;
    setBusy('start'); setError('');
    try {
      const next = await startTrainingAssessment(selected.id); setAttempt(next); setQuestionIndex(Math.min(next.questions.length - 1, next.questions.filter(item => next.feedback?.[item.id]?.correct).length)); setAnswers(next.answers || {}); setAnswerFeedback(next.feedback || {}); setResult(null); setShowFeedback(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The assessment could not start. Refresh the module status.'); }
    finally { setBusy(''); }
  }
  async function checkAnswer(answer: string) {
    if (!attempt || !question || !online || busy || answerFeedback[question.id]?.correct) return;
    setAnswers(current => ({ ...current, [question.id]: answer })); setBusy('check'); setError('');
    try { const feedback = await checkTrainingAnswer(attempt.id, question.id, answer); setAnswerFeedback(current => ({ ...current, [question.id]: feedback })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'This answer could not be checked. Try again.'); }
    finally { setBusy(''); }
  }
  async function submit() {
    if (!attempt || attempt.questions.some(question => !answerFeedback[question.id]?.correct) || !online || busy) return;
    setBusy('submit'); setError('');
    try {
      const marked = await submitTrainingAssessment(attempt.id, answers);
      setResult(marked); setAttempt(null);
      try { setData(await loadTrainingOverview()); }
      catch { setError('Your result was recorded. Reconnect and refresh to update your module list.'); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The result could not be confirmed. Keep this screen open and retry when connected.');
    } finally { setBusy(''); }
  }
  function leaveAssessment() {
    Alert.alert('Leave this assessment?', 'Your unsent answers will be cleared. You can return to the lessons and start a new assessment immediately.', [
      { text: 'Keep answering', style: 'cancel' },
      { text: 'Return to lessons', style: 'destructive', onPress: () => { setAttempt(null); setAnswers({}); setError(''); } },
    ]);
  }
  const modules = data?.modules || [];
  const programs = [...new Set([...modules.map(module => module.programCode), ...(data?.unavailableActivities || []).map(module => module.programCode)])].sort();
  const matches = (module: { title: string; id: string; programCode: string }) => (!program || module.programCode === program)
    && `${module.title} ${module.id} ${module.programCode}`.toLowerCase().includes(search.trim().toLowerCase());
  const matching = modules.filter(matches);
  const unavailable = (data?.unavailableActivities || []).filter(matches);
  const lesson = selected?.lessons[lessonIndex];
  const question = attempt?.questions[questionIndex];
  const allRead = Boolean(selected?.lessons.length && selected.lessons.every((_, index) => readLessons.includes(index)));
  const startReason = selected && !selected.assessmentAvailable ? assessmentReason(selected)
    : selected?.status === 'passed' ? 'Your learning pass is recorded. You can review the lessons at any time.'
    : !online ? 'Reconnect to start the assessment.'
    : !allRead ? 'Read and mark every lesson before starting the assessment.' : 'All lessons are marked read. You are ready to start the assessment.';
  const sources = (ids: string[]) => selected?.sources.filter(source => ids.includes(source.id) && learnerSource(source)) || [];
  const sourceLinks = (ids: string[]) => sources(ids).map(source => <Pressable key={source.id} accessibilityRole="link" onPress={() => void openSource(source)} style={styles.source}><Text style={styles.link}>{source.title} ↗</Text></Pressable>);

  return <Screen scrollKey={`${selected?.id || 'list'}:${attempt ? `question-${questionIndex}` : result ? 'result' : `lesson-${lessonIndex}`}`}>
    <View style={styles.hero}><Text style={styles.eyebrow}>YOUR COMPLIANCE TO-DO LIST</Text><Text accessibilityRole="header" style={styles.heading}>Activity training</Text><Text style={styles.body}>Your own current activity pass is required before government program work. Business setup, current insurance, licences and job evidence also remain required.</Text></View>
    {data?.trainingServiceStates?.length ? <Text style={styles.note}>Training for {data.trainingServiceStates.join(', ')}, plus relevant national programs. The business owner manages service states in Business settings on TLink.</Text> : null}
    <Text style={styles.note}>Training and assessment require internet access. Checked answers are saved as you go. Reopen the module to resume your current attempt.</Text>
    {!online && <Text accessibilityLiveRegion="polite" style={styles.warning}>You are offline. Reconnect to load training, open sources or submit your assessment.</Text>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!selected && <>
      <View style={styles.card}><View style={styles.row}><Text accessibilityRole="header" style={styles.title}>{modules.filter(module => module.status === 'passed').length} of {modules.length} modules passed</Text><FieldButton variant="secondary" loading={busy === 'load'} disabled={!online || Boolean(busy)} onPress={() => void refresh()}>Refresh</FieldButton></View>
        {data && <><Text style={styles.badge}>Business: {data.business.approved ? 'Setup complete' : data.business.status === 'suspended' ? 'Setup suspended' : 'Finish setup'}</Text>{data.business.blockedReasons.map(reason => <Text key={reason} style={styles.body}>{reason}</Text>)}{!data.business.approved && <Text style={styles.note}>The business owner completes the private Creditex application and agreement in business setup.</Text>}</>}
      </View>
      <Text style={styles.label}>Find an activity</Text><TextInput style={styles.input} accessibilityLabel="Find an activity" placeholder="Activity number, program or work type" placeholderTextColor={colours.muted} value={search} onChangeText={value => { setSearch(value); setVisible(12); }} autoCorrect={false} />
      <Text style={styles.label}>Program</Text><ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.programs} accessibilityLabel="Filter by exact program">{['', ...programs].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: value === program }} style={[styles.chip, value === program && styles.selected]} onPress={() => { setProgram(value); setVisible(12); }}><Text style={styles.chipText}>{value || 'All programs'}</Text></Pressable>)}</ScrollView>
      <Text style={styles.note}>Showing {Math.min(visible, matching.length)} of {matching.length} matching activities.</Text>
      {matching.slice(0, visible).map(module => <View key={module.id} style={styles.card}><Text style={styles.eyebrow}>{module.programCode} · {module.activityTemplateIds.join(', ')}</Text><Text accessibilityRole="header" style={styles.title}>{module.title}</Text><Text style={module.status === 'passed' ? styles.success : styles.badge}>{module.status === 'passed' ? '✓ Passed' : learningStatus(module.status)}</Text><Text style={styles.body}>{module.estimatedMinutes} minutes · Pass mark {module.passPercent}% · Version {module.version}</Text>{module.status === 'passed' && module.completion && <><Text style={styles.label}>Learning completion reference</Text><Text selectable style={styles.reference}>{module.completion.reference}</Text><Text style={styles.note}>Valid until {date(module.completion.expiresAt)}</Text></>}{!module.assessmentAvailable && <Text style={styles.warning}>{assessmentReason(module)}</Text>}<FieldButton variant="secondary" disabled={Boolean(busy)} onPress={() => openModule(module)}>Open learning material</FieldButton></View>)}
      {matching.length > visible && <FieldButton variant="secondary" onPress={() => setVisible(value => value + 12)}>Show 12 more activities</FieldButton>}
      {data && !modules.length && <Text style={styles.body}>No modules are assigned to your work types and service locations. Ask the business owner to check business service selections and your Team capabilities. An empty list does not approve program work.</Text>}
      {modules.length > 0 && !matching.length && <Text style={styles.body}>No activity matches. Change the search or program.</Text>}
      {unavailable.map(module => <View key={module.id} style={styles.card}><Text style={styles.title}>{module.programCode} · {module.title}</Text><Text style={styles.warning}>{module.message}</Text></View>)}
    </>}
    {selected && <>
      <Text style={styles.eyebrow}>{selected.programCode} · {selected.activityTemplateIds.join(', ')}</Text><Text accessibilityRole="header" style={styles.title}>{selected.title}</Text>
      {!attempt && !result && lesson && <View style={styles.card}>
        <Text style={styles.badge}>Lesson {lessonIndex + 1} of {selected.lessons.length}</Text><Text accessibilityRole="header" style={styles.title}>{lesson.title}</Text><Text style={styles.body}>{lesson.body}</Text>{sourceLinks(lesson.sourceIds)}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: readLessons.includes(lessonIndex) }} onPress={() => setReadLessons(current => current.includes(lessonIndex) ? current.filter(index => index !== lessonIndex) : [...current, lessonIndex])} style={styles.option}><Text style={styles.body}>{readLessons.includes(lessonIndex) ? '☑' : '☐'} I have read this lesson and its relevant source guidance.</Text></Pressable>
        <View style={styles.row}><FieldButton variant="secondary" disabled={lessonIndex === 0} onPress={() => setLessonIndex(value => value - 1)}>Previous lesson</FieldButton>{lessonIndex < selected.lessons.length - 1 ? <FieldButton variant="secondary" onPress={() => setLessonIndex(value => value + 1)}>Next lesson</FieldButton> : <Text accessibilityLiveRegion="polite" style={styles.label}>{allRead ? selected.status === 'passed' ? 'Lessons complete. Your learning pass is recorded.' : selected.assessmentAvailable ? 'Lessons complete. Continue to the assessment below.' : 'Lessons complete. Assessment is unavailable; see the reason below.' : 'Final lesson. Mark every lesson read to continue.'}</Text>}</View>
        <Text style={styles.body}>Choose an answer to check it. If it is incorrect, read the explanation and choose again. Correct every question to reach 100%.</Text>

        <Text accessibilityLiveRegion="polite" style={styles.note}>{startReason}</Text>
        <FieldButton loading={busy === 'start'} disabled={!allRead || !selected.assessmentAvailable || selected.status === 'passed' || !online || Boolean(busy)} onPress={() => void start()}>Start assessment</FieldButton>
      </View>}
      {attempt && question && <View style={styles.card}>
        <Text style={styles.badge}>Question {questionIndex + 1} of {attempt.questions.length} · {Object.keys(answers).length} answered</Text><Text accessibilityRole="header" style={styles.title}>{question.prompt}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={question.prompt} style={styles.options}>{question.options.map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: answers[question.id] === option.id, disabled: Boolean(busy) || answerFeedback[question.id]?.correct }} disabled={Boolean(busy) || answerFeedback[question.id]?.correct} style={[styles.option, answers[question.id] === option.id && styles.selected]} onPress={() => void checkAnswer(option.id)}><Text style={styles.body}>{answers[question.id] === option.id ? '●' : '○'} {option.text}</Text></Pressable>)}</View>
        <Text accessibilityLiveRegion="polite" style={styles.note}>{busy === 'check' ? 'Checking your answer...' : ''}</Text>
        {answerFeedback[question.id] && <View style={styles.feedback}><Text accessibilityLiveRegion="polite" style={answerFeedback[question.id].correct ? styles.success : styles.warning}>{answerFeedback[question.id].correct ? 'Correct' : 'Incorrect answer. Read the explanation, then choose again.'}</Text><Text style={styles.label}>{answerFeedback[question.id].correctAnswer}</Text><Text style={styles.body}>{answerFeedback[question.id].explanation}</Text></View>}
        {answers[question.id] && !answerFeedback[question.id]?.correct && !busy && <FieldButton variant="secondary" disabled={!online} onPress={() => void checkAnswer(answers[question.id])}>Check selected answer</FieldButton>}
        <View style={styles.row}><FieldButton variant="secondary" disabled={questionIndex === 0 || Boolean(busy)} onPress={() => setQuestionIndex(value => value - 1)}>Previous question</FieldButton>{questionIndex < attempt.questions.length - 1 && <FieldButton disabled={!answerFeedback[question.id]?.correct || Boolean(busy)} onPress={() => setQuestionIndex(value => value + 1)}>Next question</FieldButton>}</View>
        {questionIndex === attempt.questions.length - 1 && <FieldButton loading={busy === 'submit'} disabled={!online || Boolean(busy) || attempt.questions.some(item => !answerFeedback[item.id]?.correct)} onPress={() => void submit()}>Submit assessment</FieldButton>}
      </View>}
      {result && <View style={styles.card}><Text accessibilityRole="header" style={styles.title}>{result.passed ? '✓ Assessment passed' : 'More learning is needed'}</Text><Text accessibilityLiveRegion="polite" style={styles.score}>{result.scorePercent}%</Text><Text style={styles.note}>First answers: {result.firstTryScorePercent ?? result.scorePercent}% correct before corrections.</Text><Text style={styles.body}>{result.passed ? 'Every answer is now correct. Your personal learning completion was recorded.' : 'You need 100% to pass. Review the explanations and retry immediately as often as needed.'}</Text>{result.passed && <><Text style={styles.label}>Learning completion reference</Text><Text selectable style={styles.reference}>{result.reference}</Text><Text style={styles.note}>Valid until {date(result.expiresAt)}</Text></>}<Text style={styles.note}>This records your learning. It is not a government certificate, licence or external accreditation and cannot qualify another person.</Text><FieldButton variant="secondary" onPress={() => setShowFeedback(value => !value)}>{showFeedback ? 'Hide answer explanations' : 'Review answer explanations'}</FieldButton>{showFeedback && result.feedback.map(item => <View key={item.questionId} style={styles.feedback}><Text style={styles.label}>{item.correct ? '✓ Correct' : 'Review this answer'}</Text><Text style={styles.body}>{item.prompt}</Text><Text style={styles.success}>{item.correctAnswer}</Text><Text style={styles.body}>{item.explanation}</Text>{sourceLinks(item.sourceIds)}</View>)}{!result.passed && <FieldButton loading={busy === 'start'} disabled={!online || Boolean(busy)} onPress={() => void start()}>Try the assessment again</FieldButton>}</View>}
      {attempt ? <FieldButton variant="quiet" disabled={Boolean(busy)} onPress={leaveAssessment}>Leave assessment</FieldButton>
        : <FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => { setSelected(null); setResult(null); }}>Back to activity modules</FieldButton>}
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  hero: { gap: spacing.sm }, heading: { color: colours.ink, fontSize: 28, fontWeight: '800' },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { color: colours.ink, fontSize: 19, lineHeight: 26, fontWeight: '800', flexShrink: 1 },
  body: { color: colours.ink, fontSize: 16, lineHeight: 24 }, note: { color: colours.muted, fontSize: 14, lineHeight: 21 },
  label: { color: colours.ink, fontWeight: '700', fontSize: 14 }, badge: { color: colours.green, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: colours.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colours.line, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  input: { borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, padding: spacing.md, minHeight: 50, color: colours.ink, backgroundColor: colours.surface, fontSize: 16 },
  programs: { gap: spacing.sm, paddingBottom: spacing.sm }, chip: { minHeight: 46, padding: spacing.sm, justifyContent: 'center', borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, backgroundColor: colours.surface },
  chipText: { color: colours.ink, fontWeight: '700' }, selected: { borderColor: colours.green, backgroundColor: colours.mintStrong },
  warning: { color: colours.amber, lineHeight: 22 }, error: { color: colours.red, backgroundColor: colours.redSoft, borderRadius: radius.sm, padding: spacing.md, lineHeight: 22 },
  success: { color: colours.green, fontSize: 16, lineHeight: 23 }, reference: { color: colours.ink, fontFamily: 'monospace', fontSize: 14, lineHeight: 21 },
  source: { minHeight: 46, justifyContent: 'center', paddingVertical: spacing.sm }, link: { color: colours.blue, textDecorationLine: 'underline', fontSize: 15, lineHeight: 23 },
  options: { gap: spacing.sm }, option: { minHeight: 50, padding: spacing.md, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm },
  score: { color: colours.green, fontSize: 36, fontWeight: '800' }, feedback: { borderTopWidth: 1, borderTopColor: colours.line, paddingTop: spacing.md, gap: spacing.sm },
});
