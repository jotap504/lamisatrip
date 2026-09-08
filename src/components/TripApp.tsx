'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { balanceByMember, settlementRows, stageSnapshot, totalSpent } from '@/lib/expenseMath'
import { createSupabaseBrowserClient } from '@/lib/supabaseClient'

type Member = {
  id: string
  name: string
  email: string
  alias: string
}

type Expense = {
  id: string
  stageId: string | null
  title: string
  amount: number
  payerId: string
  participantIds: string[]
  createdAt: string
}

type ExpenseStage = {
  id: string
  name: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt: string | null
  snapshot: {
    total: number
    expenseCount: number
    expenses: Expense[]
    balances: Record<string, number>
    settlements: Array<{
      from: Member
      to: Member
      amount: number
    }>
  } | null
}

type Trip = {
  id: string
  name: string
  key: string
  code: string
}

type AppState = {
  trip: Trip | null
  currentEmail: string | null
  members: Member[]
  expenses: Expense[]
  stages: ExpenseStage[]
}

type AuthUser = {
  email: string
  name: string
}

type ExpensePreset = {
  id: string
  name: string
  participantIds: string[]
}

type TriviaQuestion = {
  question: string
  answer: string
  acceptedAnswers: string[]
}

const emptyState: AppState = {
  trip: null,
  currentEmail: null,
  members: [],
  expenses: [],
  stages: [],
}

const currency = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

function uid() {
  return crypto.randomUUID()
}

function shuffled<T>(items: T[]) {
  return items
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item)
}

const triviaQuestions: TriviaQuestion[] = [
  {
    question: 'Capital de la provincia de Mendoza.',
    answer: 'Mendoza',
    acceptedAnswers: ['mendoza'],
  },
  {
    question: 'Equipo argentino conocido como el Millonario.',
    answer: 'River Plate',
    acceptedAnswers: ['river', 'river plate'],
  },
  {
    question: 'Provincia argentina donde esta Mar del Plata.',
    answer: 'Buenos Aires',
    acceptedAnswers: ['buenos aires', 'provincia de buenos aires'],
  },
  {
    question: 'Bebida que se toma con bombilla y yerba.',
    answer: 'Mate',
    acceptedAnswers: ['mate', 'el mate'],
  },
  {
    question: 'Cerro famoso de Bariloche con aerosilla y vista panoramica.',
    answer: 'Cerro Campanario',
    acceptedAnswers: ['campanario', 'cerro campanario'],
  },
  {
    question: 'Ciudad argentina conocida como la Feliz.',
    answer: 'Mar del Plata',
    acceptedAnswers: ['mar del plata', 'mardel'],
  },
]

export function TripApp() {
  const [state, setState] = useState<AppState>(emptyState)
  const [activeTab, setActiveTab] = useState('expenses')
  const [expenseParticipants, setExpenseParticipants] = useState<string[]>([])
  const [randomParticipants, setRandomParticipants] = useState<string[]>([])
  const [randomMode, setRandomMode] = useState('task')
  const [taskWinnerCount, setTaskWinnerCount] = useState(1)
  const [roomCount, setRoomCount] = useState(2)
  const [randomResult, setRandomResult] = useState('Todavia no hiciste ningun sorteo.')
  const [eliminationPool, setEliminationPool] = useState<string[]>([])
  const [eliminatedIds, setEliminatedIds] = useState<string[]>([])
  const [triviaQuestion, setTriviaQuestion] = useState<TriviaQuestion | null>(null)
  const [triviaAnswer, setTriviaAnswer] = useState('')
  const [triviaMessage, setTriviaMessage] = useState('')
  const [joinMessage, setJoinMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [expenseTitle, setExpenseTitle] = useState('')
  const [expensePresets, setExpensePresets] = useState<ExpensePreset[]>([])
  const [presetParticipants, setPresetParticipants] = useState<string[]>([])
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)

  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user
      if (!user?.email) return
      const name = String(user.user_metadata?.display_name || user.email.split('@')[0])
      setAuthUser({ email: user.email, name })
      const savedTrip = localStorage.getItem('lamisatrip-current-trip')
      if (savedTrip) loadTrip(savedTrip, user.email)
    })
  }, [supabase])

  useEffect(() => {
    setExpenseParticipants(state.members.map((member) => member.id))
    setPresetParticipants(state.members.map((member) => member.id))
    setRandomParticipants(state.members.map((member) => member.id))
    setEliminationPool(state.members.map((member) => member.id))
    setEliminatedIds([])
  }, [state.members])

  useEffect(() => {
    if (!state.trip) return
    const saved = localStorage.getItem(`lamisatrip-presets-${state.trip.id}`)
    if (saved) {
      setExpensePresets(JSON.parse(saved))
      return
    }

    const allMembers = state.members.map((member) => member.id)
    setExpensePresets([
      { id: uid(), name: 'Comida', participantIds: allMembers },
      { id: uid(), name: 'Bebida alcoholica', participantIds: allMembers },
      { id: uid(), name: 'Dulces / postres', participantIds: allMembers },
    ])
  }, [state.trip, state.members])

  useEffect(() => {
    if (!state.trip) return
    localStorage.setItem(`lamisatrip-presets-${state.trip.id}`, JSON.stringify(expensePresets))
  }, [expensePresets, state.trip])

  const currentMember = state.members.find((member) => member.email === state.currentEmail) || state.members[0]
  const openStage = state.stages.find((stage) => stage.status === 'open') || null
  const activeExpenses = useMemo(
    () => openStage ? state.expenses.filter((expense) => expense.stageId === openStage.id) : [],
    [state.expenses, openStage],
  )
  const balances = useMemo(() => balanceByMember(state.members, activeExpenses), [state.members, activeExpenses])
  const settlements = useMemo(() => settlementRows(state.members, activeExpenses), [state.members, activeExpenses])
  const tripTotal = totalSpent(activeExpenses)

  async function signInOrSignUp(email: string, password: string, name: string) {
    if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
    const signIn = await supabase.auth.signInWithPassword({ email, password })
    if (!signIn.error) return

    const signUp = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    })

    if (signUp.error) throw signUp.error
    if (!signUp.data.session) {
      throw new Error('Supabase esta pidiendo confirmar email. Desactiva "Confirm email" en Auth para este login simple.')
    }
  }

  async function quickLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatusMessage('')
    setIsLoading(true)
    const form = new FormData(event.currentTarget)
    const email = String(form.get('loginEmail')).toLowerCase()
    const name = String(form.get('loginName'))

    try {
      await signInOrSignUp(email, String(form.get('loginPassword')), name)
      setAuthUser({ email, name })
      const savedTrip = localStorage.getItem('lamisatrip-current-trip')
      if (savedTrip) await loadTrip(savedTrip, email)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No pude iniciar sesion.')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadTrip(tripId: string, email: string) {
    if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
    const { data: trip, error: tripError } = await supabase
      .from('app_trips')
      .select('id, name, invite_code')
      .eq('id', tripId)
      .single()

    if (tripError) throw tripError

    const { data: memberRows, error: membersError } = await supabase
      .from('app_trip_members')
      .select('id, profile:app_profiles(email, display_name, payment_alias)')
      .eq('trip_id', tripId)
      .order('joined_at')

    if (membersError) throw membersError

    const { data: stageRows, error: stagesError } = await supabase
      .from('app_expense_stages')
      .select('id, name, status, opened_at, closed_at, snapshot')
      .eq('trip_id', tripId)
      .order('opened_at')

    if (stagesError) throw stagesError

    let stages = (stageRows || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      snapshot: row.snapshot,
    })) as ExpenseStage[]

    if (!stages.length) {
      const nextNumber = stages.length + 1
      const { data: createdStage, error: createStageError } = await supabase
        .from('app_expense_stages')
        .insert({
          trip_id: tripId,
          name: `Etapa ${nextNumber}`,
          created_by_member_id: null,
        })
        .select('id, name, status, opened_at, closed_at, snapshot')
        .single()

      if (createStageError) throw createStageError
      stages = [
        ...stages,
        {
          id: createdStage.id,
          name: createdStage.name,
          status: createdStage.status,
          openedAt: createdStage.opened_at,
          closedAt: createdStage.closed_at,
          snapshot: createdStage.snapshot,
        },
      ]
    }

    const { data: expenseRows, error: expensesError } = await supabase
      .from('app_expenses')
      .select('id, stage_id, title, amount, payer_member_id, created_at, splits:app_expense_splits(member_id)')
      .eq('trip_id', tripId)
      .order('created_at')

    if (expensesError) throw expensesError

    const members = (memberRows || []).map((row: any) => ({
      id: row.id,
      name: row.profile?.display_name || row.profile?.email || 'Sin nombre',
      email: row.profile?.email || '',
      alias: row.profile?.payment_alias || '',
    }))

    const expenses = (expenseRows || []).map((row: any) => ({
      id: row.id,
      stageId: row.stage_id,
      title: row.title,
      amount: Number(row.amount),
      payerId: row.payer_member_id,
      participantIds: (row.splits || []).map((split: any) => split.member_id),
      createdAt: row.created_at,
    }))

    localStorage.setItem('lamisatrip-current-trip', trip.id)
    localStorage.setItem('lamisatrip-current-email', email)
    setState({
      trip: {
        id: trip.id,
        name: trip.name,
        key: '',
        code: trip.invite_code,
      },
      currentEmail: email,
      members,
      expenses,
      stages,
    })
  }

  async function createTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setJoinMessage('')
    setStatusMessage('')
    setIsLoading(true)
    const form = new FormData(event.currentTarget)
    if (!authUser) return

    try {
      if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
      const { data, error } = await supabase.rpc('app_create_trip', {
        trip_name: String(form.get('tripName')),
        trip_key: String(form.get('tripKey')),
        display_name: authUser.name,
      })
      if (error) throw error
      await loadTrip(data[0].trip_id, authUser.email)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No pude crear el viaje.')
    } finally {
      setIsLoading(false)
    }
  }

  async function joinTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setJoinMessage('')
    setStatusMessage('')
    setIsLoading(true)
    if (!authUser) return

    try {
      if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
      const code = String(form.get('joinCode') || '').trim().replace(/^.*trip=/, '').split(/[&\s]/)[0]
      const { data, error } = await supabase.rpc('app_join_trip', {
        invite: code,
        trip_key: String(form.get('joinKey')),
        display_name: authUser.name,
      })
      if (error) throw error
      await loadTrip(data[0].trip_id, authUser.email)
    } catch (error) {
      setJoinMessage(error instanceof Error ? error.message : 'No pude entrar al viaje.')
    } finally {
      setIsLoading(false)
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!state.trip) return
    setStatusMessage('Para sumar integrantes ahora comparti el link y la clave. Cada amigo entra con su email y contraseña.')
    event.currentTarget.reset()
  }

  async function updateCurrentAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const alias = String(form.get('profileAlias') || '')
    if (!currentMember) return
    setIsLoading(true)
    try {
      if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
      const { data: memberRow, error: memberError } = await supabase
        .from('app_trip_members')
        .select('profile_id')
        .eq('id', currentMember.id)
        .single()
      if (memberError) throw memberError

      const { error } = await supabase
        .from('app_profiles')
        .update({ payment_alias: alias, updated_at: new Date().toISOString() })
        .eq('id', memberRow.profile_id)
      if (error) throw error
      await loadTrip(state.trip!.id, state.currentEmail!)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No pude guardar tus datos.')
    } finally {
      setIsLoading(false)
    }
  }

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!expenseParticipants.length || !state.trip || !currentMember || !openStage) return
    setIsLoading(true)
    try {
      if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
      const amount = Number(form.get('expenseAmount'))
      const { data: expense, error: expenseError } = await supabase
        .from('app_expenses')
        .insert({
          trip_id: state.trip.id,
          stage_id: openStage.id,
          title: String(form.get('expenseTitle')),
          amount,
          payer_member_id: String(form.get('payerId')),
          created_by_member_id: currentMember.id,
        })
        .select('id')
        .single()
      if (expenseError) throw expenseError

      const share = amount / expenseParticipants.length
      const { error: splitError } = await supabase
        .from('app_expense_splits')
        .insert(expenseParticipants.map((memberId) => ({
          expense_id: expense.id,
          member_id: memberId,
          share_amount: share,
        })))
      if (splitError) throw splitError

      await loadTrip(state.trip.id, state.currentEmail!)
      setExpenseTitle('')
      event.currentTarget.reset()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No pude guardar el gasto.')
    } finally {
      setIsLoading(false)
    }
  }

  async function closeCurrentStage() {
    if (!state.trip || !openStage || !currentMember) return
    setStatusMessage('')
    setIsLoading(true)
    try {
      if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
      const snapshot = stageSnapshot(state.members, activeExpenses)
      const { error } = await supabase
        .from('app_expense_stages')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by_member_id: currentMember.id,
          snapshot,
        })
        .eq('id', openStage.id)
      if (error) throw error

      await loadTrip(state.trip.id, state.currentEmail!)
      setStatusMessage('Etapa cerrada. Si quieren seguir separando gastos, creen una nueva etapa.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No pude cerrar la etapa.')
    } finally {
      setIsLoading(false)
    }
  }

  async function createNewStage() {
    if (!state.trip || !currentMember || openStage) return
    setStatusMessage('')
    setIsLoading(true)
    try {
      if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
      const nextNumber = state.stages.length + 1
      const { error } = await supabase
        .from('app_expense_stages')
        .insert({
          trip_id: state.trip.id,
          name: `Etapa ${nextNumber}`,
          created_by_member_id: currentMember.id,
        })
      if (error) throw error
      await loadTrip(state.trip.id, state.currentEmail!)
      setActiveTab('expenses')
      setStatusMessage('Nueva etapa creada. Ya pueden cargar gastos ahi.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No pude crear la nueva etapa.')
    } finally {
      setIsLoading(false)
    }
  }

  async function reopenStage(stageId: string) {
    if (!state.trip) return
    setStatusMessage('')
    setIsLoading(true)
    try {
      if (!supabase) throw new Error('Faltan variables de Supabase en este deploy.')
      const openStages = state.stages.filter((stage) => stage.status === 'open')
      if (openStages.length) {
        const { error: closeError } = await supabase
          .from('app_expense_stages')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .eq('id', openStages[0].id)
        if (closeError) throw closeError
      }

      const { error } = await supabase
        .from('app_expense_stages')
        .update({
          status: 'open',
          closed_at: null,
          closed_by_member_id: null,
          snapshot: null,
        })
        .eq('id', stageId)
      if (error) throw error
      await loadTrip(state.trip.id, state.currentEmail!)
      setActiveTab('expenses')
      setStatusMessage('Etapa reabierta. Los gastos nuevos se cargan ahi.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No pude reabrir la etapa.')
    } finally {
      setIsLoading(false)
    }
  }

  function runRandom() {
    const participants = shuffled(
      randomParticipants
        .map((id) => state.members.find((member) => member.id === id))
        .filter((member): member is Member => Boolean(member)),
    )
    if (!participants.length) return

    if (randomMode === 'task') {
      const winners = participants.slice(0, Math.max(1, Math.min(taskWinnerCount, participants.length)))
      setRandomResult(winners.length === 1 ? `Sale elegido: ${winners[0].name}` : `Salen elegidos: ${winners.map((member) => member.name).join(', ')}`)
      return
    }

    if (randomMode === 'pairs') {
      const pairs = []
      for (let index = 0; index < participants.length; index += 2) {
        pairs.push(participants.slice(index, index + 2).map((member) => member.name).join(' + '))
      }
      setRandomResult(pairs.map((pair, index) => `Pareja ${index + 1}: ${pair}`).join('\n'))
      return
    }

    const rooms = Array.from({ length: Math.max(1, roomCount) }, () => [] as string[])
    participants.forEach((member, index) => rooms[index % roomCount].push(member.name))
    setRandomResult(rooms.map((room, index) => `Habitacion ${index + 1}: ${room.join(', ') || 'Libre'}`).join('\n'))
  }

  function normalizeAnswer(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
  }

  function startEliminationGame() {
    const selected = randomParticipants.length ? randomParticipants : state.members.map((member) => member.id)
    setEliminationPool(selected)
    setEliminatedIds([])
    setTriviaQuestion(shuffled(triviaQuestions)[0])
    setTriviaAnswer('')
    setTriviaMessage('Pregunta lista. El primero que la acierta se salva del sorteo.')
  }

  function submitTriviaAnswer() {
    if (!triviaQuestion) return
    const answer = normalizeAnswer(triviaAnswer)
    const isCorrect = triviaQuestion.acceptedAnswers.some((accepted) => normalizeAnswer(accepted) === answer)
    setTriviaMessage(isCorrect ? 'Correcta. Marca quien respondio bien para sacarlo del sorteo.' : 'No era. Sigan intentando.')
  }

  function eliminateFromRandom(memberId: string) {
    if (!triviaQuestion || eliminatedIds.includes(memberId)) return
    const member = state.members.find((person) => person.id === memberId)
    const nextEliminated = [...eliminatedIds, memberId]
    const remaining = eliminationPool.filter((id) => !nextEliminated.includes(id))
    setEliminatedIds(nextEliminated)
    setRandomParticipants(remaining)
    setTriviaAnswer('')
    setTriviaQuestion(shuffled(triviaQuestions)[0])
    setTriviaMessage(`${member?.name || 'Alguien'} queda fuera del sorteo. Quedan ${remaining.length}.`)
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value)
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut()
    localStorage.removeItem('lamisatrip-current-trip')
    localStorage.removeItem('lamisatrip-current-email')
    setState(emptyState)
    setAuthUser(null)
  }

  function applyExpensePreset(preset: ExpensePreset) {
    setExpenseTitle(preset.name)
    setExpenseParticipants(preset.participantIds.filter((id) => state.members.some((member) => member.id === id)))
  }

  function addExpensePreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('presetName') || '').trim()
    if (!name) return

    if (editingPresetId) {
      setExpensePresets((current) => current.map((preset) => (
        preset.id === editingPresetId
          ? { ...preset, name, participantIds: presetParticipants }
          : preset
      )))
      setEditingPresetId(null)
      event.currentTarget.reset()
      return
    }

    setExpensePresets((current) => [
      ...current,
      {
        id: uid(),
        name,
        participantIds: presetParticipants.length ? presetParticipants : state.members.map((member) => member.id),
      },
    ])
    event.currentTarget.reset()
  }

  function editExpensePreset(preset: ExpensePreset) {
    setEditingPresetId(preset.id)
    setPresetParticipants(preset.participantIds.filter((id) => state.members.some((member) => member.id === id)))
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('input[name="presetName"]')
      if (input) {
        input.value = preset.name
        input.focus()
      }
    })
  }

  function deleteExpensePreset(presetId: string) {
    setExpensePresets((current) => current.filter((preset) => preset.id !== presetId))
    if (editingPresetId === presetId) setEditingPresetId(null)
  }

  if (!authUser) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">La misa se traslada</p>
            <h1>Lamisatrip</h1>
          </div>
        </header>

        <section className="welcome-screen">
          <div className="welcome-copy">
            <p className="eyebrow">Viajes con amigos</p>
            <h2>La misa se traslada.</h2>
            <p className="muted">Gastos claros, sorteos justos y pequenas decisiones grupales resueltas sin debate eterno.</p>
            <div className="fun-strip" aria-label="Funciones principales">
              <span>Gastos</span>
              <span>Sorteos</span>
              <span>Etapas</span>
              <span>Juegos</span>
            </div>
          </div>

          <form className="form-card auth-card" onSubmit={quickLogin}>
            <div>
              <p className="eyebrow">Login simple</p>
              <h2>Entrar</h2>
            </div>
            <label>
              Tu nombre
              <input name="loginName" required placeholder="Tu nombre" />
            </label>
            <label>
              Tu email
              <input name="loginEmail" required type="email" placeholder="tu@mail.com" />
            </label>
            <label>
              Tu contraseña
              <input name="loginPassword" required type="password" minLength={6} placeholder="Minimo 6 caracteres" />
            </label>
            {statusMessage && <p className="form-note">{statusMessage}</p>}
            <button className="primary-button" disabled={isLoading} type="submit">
              {isLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  if (!state.trip) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Hola, {authUser.name}</p>
            <h1>Lamisatrip</h1>
          </div>
          <button className="secondary-button" type="button" onClick={logout}>Salir</button>
        </header>

        <section className="welcome-screen">
          <div className="welcome-copy">
            <p className="eyebrow">Elegir viaje</p>
            <h2>Sumate con un codigo o crea un viaje nuevo.</h2>
            <p className="muted">Cuando entres, este viaje queda recordado en tu cuenta para cargarlo automaticamente la proxima vez.</p>
          </div>

          <div className="welcome-grid">
            <form className="form-card" onSubmit={joinTrip}>
              <div>
                <p className="eyebrow">Tengo invitacion</p>
                <h2>Sumarme a viaje</h2>
              </div>
              <label>
                Codigo o link
                <input name="joinCode" required placeholder="Pegar link o codigo" />
              </label>
              <label>
                Clave del viaje
                <input name="joinKey" required placeholder="Clave que paso el organizador" />
              </label>
              {joinMessage && <p className="form-note">{joinMessage}</p>}
              <button className="primary-button" disabled={isLoading} type="submit">
                {isLoading ? 'Entrando...' : 'Sumarme'}
              </button>
            </form>

            <form className="form-card" onSubmit={createTrip}>
              <div>
                <p className="eyebrow">Armar la mesa</p>
                <h2>Crear viaje</h2>
              </div>
              <label>
                Nombre del viaje
                <input name="tripName" required placeholder="Bariloche 2026" />
              </label>
              <label>
                Clave del viaje
                <input name="tripKey" required placeholder="bariloche2026" />
              </label>
              <label>
                Participantes previstos
                <textarea name="plannedParticipants" placeholder="Ana - ana@mail.com&#10;Bruno - bruno@mail.com" />
              </label>
              <p className="muted">Por ahora esta lista te sirve para tenerlos a mano. Para unirse, cada persona usa el link y la clave.</p>
              {statusMessage && <p className="form-note">{statusMessage}</p>}
              <button className="primary-button" disabled={isLoading} type="submit">
                {isLoading ? 'Creando...' : 'Crear viaje'}
              </button>
            </form>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Viaje activo</p>
          <h1>Lamisatrip</h1>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Copiar invitacion"
          onClick={() => copyText(`${location.origin}/?trip=${state.trip?.code}`)}
        >
          <CopyIcon />
        </button>
      </header>

      <section className="trip-card">
        <div>
          <p className="eyebrow">Clave del viaje</p>
          <h2>{state.trip.name}</h2>
          <p className="muted">Codigo de invitacion: <strong>{state.trip.code}</strong></p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setActiveTab('group')}>
          Mi perfil
        </button>
      </section>
      {statusMessage && <p className="form-note app-note">{statusMessage}</p>}

      <section className="summary-grid" aria-label="Resumen del viaje">
        <article>
          <span>Total etapa actual</span>
          <strong>{currency.format(tripTotal)}</strong>
        </article>
        <article>
          <span>Tu balance</span>
          <strong className={(balances[currentMember?.id || ''] || 0) >= 0 ? 'balance-positive' : 'balance-negative'}>
            {currency.format(balances[currentMember?.id || ''] || 0)}
          </strong>
        </article>
        <article>
          <span>Gastos etapa</span>
          <strong>{activeExpenses.length}</strong>
        </article>
      </section>

      <nav className="tabs" aria-label="Secciones">
        {[
          ['expenses', 'Gastos'],
          ['settle', 'Cierre'],
          ['random', 'Random'],
          ['group', 'Grupo'],
        ].map(([id, label]) => (
          <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)} type="button">
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'expenses' && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Caja del viaje</p>
              <h2>{openStage ? openStage.name : 'Sin etapa abierta'}</h2>
              <p className="muted">
                {openStage
                  ? 'Los gastos que cargues ahora quedan dentro de esta etapa.'
                  : 'La ultima etapa quedo cerrada. Crea una nueva etapa si quieren seguir cargando gastos.'}
              </p>
            </div>
          </div>
          <form className="form-card" onSubmit={addExpense}>
            <div>
              <p className="eyebrow">Opciones rapidas</p>
              <h2>Predeterminados</h2>
            </div>
            <div className="preset-grid">
              {expensePresets.map((preset) => (
                <article className="preset-card" key={preset.id}>
                  <button className="preset-button" type="button" onClick={() => applyExpensePreset(preset)}>
                    <strong>{preset.name}</strong>
                    <span>{preset.participantIds.length === state.members.length ? 'Todos' : `${preset.participantIds.length} participan`}</span>
                  </button>
                  <div className="preset-actions">
                    <button className="mini-button" type="button" onClick={() => editExpensePreset(preset)}>Editar</button>
                    <button className="mini-button" type="button" onClick={() => deleteExpensePreset(preset.id)}>Borrar</button>
                  </div>
                </article>
              ))}
            </div>
            <div className="preset-editor">
              <label>
                {editingPresetId ? 'Editar opcion' : 'Nueva opcion'}
                <input form="presetForm" name="presetName" placeholder="Ej: excursiones, taxi, helado" />
              </label>
              <ChipPicker
                members={state.members}
                selected={presetParticipants}
                onChange={setPresetParticipants}
                showAllButton
              />
              <div className="preset-editor-actions">
                <button className="secondary-button" form="presetForm" type="submit">
                  {editingPresetId ? 'Guardar opcion' : 'Crear opcion'}
                </button>
                {editingPresetId && (
                  <button className="copy-button" type="button" onClick={() => setEditingPresetId(null)}>Cancelar</button>
                )}
              </div>
            </div>
            <label>
              Concepto
              <input
                name="expenseTitle"
                required
                placeholder="Super, nafta, cena..."
                value={expenseTitle}
                onChange={(event) => setExpenseTitle(event.target.value)}
              />
            </label>
            <div className="form-row">
              <label>
                Monto
                <input name="expenseAmount" required type="number" min="1" step="1" placeholder="25000" />
              </label>
              <label>
                Pago
                <select name="payerId" defaultValue={currentMember?.id}>
                  {state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </label>
            </div>
            <ChipPicker members={state.members} selected={expenseParticipants} onChange={setExpenseParticipants} showAllButton />
            <button className="primary-button" disabled={!openStage || isLoading} type="submit">Guardar gasto</button>
          </form>
          {!openStage && (
            <button className="primary-button" disabled={isLoading} type="button" onClick={createNewStage}>
              Crear nueva etapa
            </button>
          )}
          <form id="presetForm" onSubmit={addExpensePreset} />
          <div className="list">
            {activeExpenses.length === 0 && <div className="empty-state">Todavia no hay gastos cargados en esta etapa.</div>}
            {activeExpenses.slice().reverse().map((expense) => {
              const payer = state.members.find((member) => member.id === expense.payerId)
              const participants = expense.participantIds
                .map((id) => state.members.find((member) => member.id === id)?.name)
                .filter(Boolean)
                .join(', ')
              return (
                <article className="list-item" key={expense.id}>
                  <div className="money-line">
                    <strong>{expense.title}</strong>
                    <strong>{currency.format(expense.amount)}</strong>
                  </div>
                  <p className="muted">Pago {payer?.name} - dividido entre {participants}</p>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {activeTab === 'settle' && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Compensaciones</p>
              <h2>Cierre de {openStage?.name || 'etapa'}</h2>
              <p className="muted">Al cerrar se guarda el registro de gastos, pagos y compensaciones de esta etapa.</p>
            </div>
          </div>
          <div className="stage-actions">
            {openStage ? (
              <button className="primary-button" disabled={isLoading || activeExpenses.length === 0} type="button" onClick={closeCurrentStage}>
                {isLoading ? 'Cerrando...' : 'Cerrar etapa'}
              </button>
            ) : (
              <button className="primary-button" disabled={isLoading} type="button" onClick={createNewStage}>
                Crear nueva etapa
              </button>
            )}
            <p className="muted">
              {openStage
                ? 'Cerrar guarda esta etapa y deja el viaje sin caja abierta hasta que creen otra.'
                : 'No hay una etapa abierta. El historial sigue disponible abajo.'}
            </p>
          </div>
          <div className="list">
            {settlements.length === 0 && <div className="empty-state">No hay deudas pendientes.</div>}
            {settlements.map((row) => (
              <article className="list-item" key={`${row.from.id}-${row.to.id}-${row.amount}`}>
                <div className="money-line">
                  <strong>{row.from.name} le paga a {row.to.name}</strong>
                  <strong>{currency.format(row.amount)}</strong>
                </div>
                <p className="muted">Alias/CBU: <strong>{row.to.alias || 'Sin cargar'}</strong></p>
                <div className="settlement-actions">
                  <button className="copy-button" type="button" onClick={() => copyText(row.to.alias)}>Copiar alias</button>
                  <button className="copy-button" type="button" onClick={() => copyText(String(Math.round(row.amount)))}>Copiar monto</button>
                  <button className="copy-button" type="button">Marcar pagado</button>
                </div>
              </article>
            ))}
          </div>
          <StageHistory stages={state.stages} members={state.members} onReopen={reopenStage} />
        </section>
      )}

      {activeTab === 'random' && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Modo random</p>
              <h2>Sorteos rapidos</h2>
            </div>
            <ShuffleIcon />
          </div>
          <div className="form-card">
            <label>
              Tipo de sorteo
              <select value={randomMode} onChange={(event) => setRandomMode(event.target.value)}>
                <option value="task">Tarea: cocina, platos, hielo</option>
                <option value="pairs">Parejas de 2</option>
                <option value="rooms">Habitaciones</option>
              </select>
            </label>
            {randomMode === 'task' && (
              <label>
                Cantidad de elegidos
                <input
                  value={taskWinnerCount}
                  onChange={(event) => setTaskWinnerCount(Number(event.target.value))}
                  type="number"
                  min="1"
                  max={Math.max(1, randomParticipants.length)}
                />
              </label>
            )}
            {randomMode === 'rooms' && (
              <label>
                Cantidad de habitaciones
                <input value={roomCount} onChange={(event) => setRoomCount(Number(event.target.value))} type="number" min="1" />
              </label>
            )}
            <ChipPicker members={state.members} selected={randomParticipants} onChange={setRandomParticipants} />
            <button className="primary-button" type="button" onClick={runRandom}>Sortear</button>
          </div>
          <div className="result-box">{randomResult}</div>
          <div className="game-card">
            <div>
              <p className="eyebrow">Juego de salvacion</p>
              <h2>Pregunta y zafas</h2>
              <p className="muted">El organizador lee la pregunta. El primero que responde bien queda fuera del sorteo.</p>
            </div>
            <button className="secondary-button" type="button" onClick={startEliminationGame}>Nueva pregunta</button>
            {triviaQuestion && (
              <>
                <div className="question-box">
                  <strong>{triviaQuestion.question}</strong>
                </div>
                <div className="form-row">
                  <label>
                    Probar respuesta
                    <input
                      value={triviaAnswer}
                      onChange={(event) => setTriviaAnswer(event.target.value)}
                      placeholder="Escribi la respuesta sin mostrarla"
                    />
                  </label>
                  <button className="primary-button" type="button" onClick={submitTriviaAnswer}>Verificar</button>
                </div>
                {triviaMessage && <p className="form-note">{triviaMessage}</p>}
                <div>
                  <p className="eyebrow">Quien acerto</p>
                  <div className="chips">
                    {eliminationPool.map((memberId) => {
                      const member = state.members.find((person) => person.id === memberId)
                      const eliminated = eliminatedIds.includes(memberId)
                      return (
                        <button
                          className={`chip ${eliminated ? 'saved' : ''}`}
                          disabled={eliminated}
                          key={memberId}
                          type="button"
                          onClick={() => eliminateFromRandom(memberId)}
                        >
                          {eliminated ? `${member?.name} salvo` : member?.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {activeTab === 'group' && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Integrantes</p>
              <h2>Grupo del viaje</h2>
            </div>
            <UserPlusIcon />
          </div>
          <form className="form-card" onSubmit={addMember}>
            <div>
              <p className="eyebrow">Alta rapida</p>
              <h2>Sumar integrante</h2>
            </div>
            <label>
              Nombre
              <input name="memberName" required placeholder="Nombre" />
            </label>
            <label>
              Email
              <input name="memberEmail" required type="email" placeholder="nombre@mail.com" />
            </label>
            <label>
              Alias o CBU
              <input name="memberAlias" placeholder="Opcional, se puede completar despues" />
            </label>
            <button className="primary-button" type="submit">Sumar integrante</button>
          </form>
          {currentMember && (
            <form className="form-card profile-card" onSubmit={updateCurrentAlias}>
              <div>
                <p className="eyebrow">Mis datos</p>
                <h2>Alias o CBU para cobrar</h2>
              </div>
              <p className="muted">Esto se muestra cuando alguien tenga que transferirte al cierre del viaje.</p>
              <label>
                Alias o CBU
                <input name="profileAlias" defaultValue={currentMember.alias} placeholder="alias.mp o CBU" />
              </label>
              <button className="secondary-button" type="submit">Guardar mis datos</button>
            </form>
          )}
          <div className="list">
            {state.members.map((member) => (
              <article className="list-item" key={member.id}>
                <div className="person-line">
                  <strong>{member.name}</strong>
                  <strong className={(balances[member.id] || 0) >= 0 ? 'balance-positive' : 'balance-negative'}>
                    {currency.format(balances[member.id] || 0)}
                  </strong>
                </div>
                <p className="muted">{member.email} - {member.alias || 'sin alias/CBU'}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function ShuffleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="section-icon"
      fill="none"
      height="28"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="28"
    >
      <path d="m18 14 4 4-4 4" />
      <path d="m18 2 4 4-4 4" />
      <path d="M2 18h1.4c2.1 0 3.3-.8 4.5-2.7l6.2-9.6C15.3 3.8 16.5 3 18.6 3H22" />
      <path d="M2 6h1.9c1.5 0 2.6.4 3.6 1.5" />
      <path d="M22 18h-3.4c-1.5 0-2.6-.4-3.6-1.5" />
    </svg>
  )
}

function UserPlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="section-icon"
      fill="none"
      height="28"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="28"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </svg>
  )
}

function StageHistory({
  stages,
  members,
  onReopen,
}: {
  stages: ExpenseStage[]
  members: Member[]
  onReopen: (stageId: string) => void
}) {
  const closedStages = stages.filter((stage) => stage.status === 'closed').slice().reverse()

  return (
    <section className="stage-history">
      <div>
        <p className="eyebrow">Historial</p>
        <h2>Etapas cerradas</h2>
      </div>
      {closedStages.length === 0 && <div className="empty-state">Todavia no cerraste ninguna etapa.</div>}
      {closedStages.map((stage) => {
        const snapshot = stage.snapshot
        return (
          <article className="list-item stage-card" key={stage.id}>
            <div className="money-line">
              <div>
                <strong>{stage.name}</strong>
                <p className="muted">{stage.closedAt ? `Cerrada el ${new Date(stage.closedAt).toLocaleDateString('es-AR')}` : 'Cerrada'}</p>
              </div>
              <strong>{currency.format(snapshot?.total || 0)}</strong>
            </div>
            <p className="muted">{snapshot?.expenseCount || 0} gastos guardados</p>

            {!!snapshot?.expenses.length && (
              <div className="stage-detail">
                <strong>Gastos</strong>
                {snapshot.expenses.map((expense) => {
                  const payer = members.find((member) => member.id === expense.payerId)
                  return (
                    <p className="muted" key={expense.id}>
                      {expense.title}: {currency.format(expense.amount)} pago {payer?.name || 'Sin nombre'}
                    </p>
                  )
                })}
              </div>
            )}

            <div className="stage-detail">
              <strong>Compensaciones</strong>
              {!snapshot?.settlements.length && <p className="muted">Sin deudas pendientes.</p>}
              {snapshot?.settlements.map((row) => (
                <p className="muted" key={`${row.from.id}-${row.to.id}-${row.amount}`}>
                  {row.from.name} le paga a {row.to.name}: {currency.format(row.amount)}
                </p>
              ))}
            </div>

            <button className="copy-button" type="button" onClick={() => onReopen(stage.id)}>Reabrir esta etapa</button>
          </article>
        )
      })}
    </section>
  )
}

function ChipPicker({
  members,
  selected,
  onChange,
  showAllButton = false,
}: {
  members: Member[]
  selected: string[]
  onChange: (selected: string[]) => void
  showAllButton?: boolean
}) {
  return (
    <fieldset>
      <legend>Participan</legend>
      <div className="chips">
        {showAllButton && (
          <button
            className={`chip chip-all ${selected.length === members.length ? 'active' : ''}`}
            type="button"
            onClick={() => onChange(members.map((member) => member.id))}
          >
            Todos
          </button>
        )}
        {members.map((member) => {
          const active = selected.includes(member.id)
          return (
            <button
              key={member.id}
              className={`chip ${active ? 'active' : ''}`}
              type="button"
              onClick={() => onChange(active ? selected.filter((id) => id !== member.id) : [...selected, member.id])}
            >
              {member.name}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
