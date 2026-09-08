'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { balanceByMember, settlementRows, totalSpent } from '@/lib/expenseMath'

type Member = {
  id: string
  name: string
  email: string
  alias: string
}

type Expense = {
  id: string
  title: string
  amount: number
  payerId: string
  participantIds: string[]
  createdAt: string
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
}

const emptyState: AppState = {
  trip: null,
  currentEmail: null,
  members: [],
  expenses: [],
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

export function TripApp() {
  const [state, setState] = useState<AppState>(emptyState)
  const [activeTab, setActiveTab] = useState('expenses')
  const [expenseParticipants, setExpenseParticipants] = useState<string[]>([])
  const [randomParticipants, setRandomParticipants] = useState<string[]>([])
  const [randomMode, setRandomMode] = useState('task')
  const [roomCount, setRoomCount] = useState(2)
  const [randomResult, setRandomResult] = useState('Todavia no hiciste ningun sorteo.')
  const [joinMessage, setJoinMessage] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('lamisatrip-state')
    if (saved) setState(JSON.parse(saved))
  }, [])

  useEffect(() => {
    localStorage.setItem('lamisatrip-state', JSON.stringify(state))
  }, [state])

  useEffect(() => {
    setExpenseParticipants(state.members.map((member) => member.id))
    setRandomParticipants(state.members.map((member) => member.id))
  }, [state.members])

  const currentMember = state.members.find((member) => member.email === state.currentEmail) || state.members[0]
  const balances = useMemo(() => balanceByMember(state.members, state.expenses), [state.members, state.expenses])
  const settlements = useMemo(() => settlementRows(state.members, state.expenses), [state.members, state.expenses])
  const tripTotal = totalSpent(state.expenses)

  function createTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setJoinMessage('')
    const form = new FormData(event.currentTarget)
    const ownerEmail = String(form.get('ownerEmail')).toLowerCase()
    setState({
      trip: {
        id: uid(),
        name: String(form.get('tripName')),
        key: String(form.get('tripKey')),
        code: uid().slice(0, 8),
      },
      currentEmail: ownerEmail,
      members: [
        {
          id: uid(),
          name: String(form.get('ownerName')),
          email: ownerEmail,
          alias: '',
        },
      ],
      expenses: [],
    })
  }

  function joinTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!state.trip) {
      setJoinMessage('Todavia no hay un viaje guardado en este navegador. Cuando conectemos Supabase, el link va a abrir el viaje compartido real.')
      return
    }
    if (form.get('joinKey') !== state.trip.key) {
      setJoinMessage('La clave del viaje no coincide.')
      return
    }
    const email = String(form.get('joinEmail')).toLowerCase()
    setJoinMessage('')
    setState((current) => ({
      ...current,
      currentEmail: email,
      members: current.members.some((member) => member.email === email)
        ? current.members
        : [
            ...current.members,
            {
              id: uid(),
              name: String(form.get('joinName')),
              email,
              alias: '',
            },
          ],
    }))
  }

  function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('memberEmail')).toLowerCase()
    setState((current) => ({
      ...current,
      members: [
        ...current.members,
        {
          id: uid(),
          name: String(form.get('memberName')),
          email,
          alias: String(form.get('memberAlias') || ''),
        },
      ],
    }))
    event.currentTarget.reset()
  }

  function updateCurrentAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const alias = String(form.get('profileAlias') || '')
    if (!currentMember) return
    setState((current) => ({
      ...current,
      members: current.members.map((member) => (
        member.id === currentMember.id ? { ...member, alias } : member
      )),
    }))
  }

  function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (!expenseParticipants.length) return
    setState((current) => ({
      ...current,
      expenses: [
        ...current.expenses,
        {
          id: uid(),
          title: String(form.get('expenseTitle')),
          amount: Number(form.get('expenseAmount')),
          payerId: String(form.get('payerId')),
          participantIds: expenseParticipants,
          createdAt: new Date().toISOString(),
        },
      ],
    }))
    event.currentTarget.reset()
  }

  function runRandom() {
    const participants = shuffled(
      randomParticipants
        .map((id) => state.members.find((member) => member.id === id))
        .filter((member): member is Member => Boolean(member)),
    )
    if (!participants.length) return

    if (randomMode === 'task') {
      setRandomResult(`Sale elegido: ${participants[0].name}`)
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

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value)
  }

  if (!state.trip) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Organiza tu grupo</p>
            <h1>Lamisatrip</h1>
          </div>
        </header>

        <section className="welcome-screen">
          <div className="welcome-copy">
            <p className="eyebrow">Viajes con amigos</p>
            <h2>Arranca creando un viaje o entrando con una invitacion.</h2>
            <p className="muted">Primero entran rapido. Despues cargan gastos, alias/CBU, balances y sorteos en un solo lugar.</p>
          </div>

          <div className="welcome-grid">
            <form className="form-card" onSubmit={createTrip}>
              <div>
                <p className="eyebrow">Nuevo viaje</p>
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
                Tu nombre
                <input name="ownerName" required placeholder="Tu nombre" />
              </label>
              <label>
                Tu email
                <input name="ownerEmail" required type="email" placeholder="tu@mail.com" />
              </label>
              <button className="primary-button" type="submit">Crear viaje</button>
            </form>

            <form className="form-card" onSubmit={joinTrip}>
              <div>
                <p className="eyebrow">Ya tengo link</p>
                <h2>Entrar a un viaje</h2>
              </div>
              <label>
                Codigo o link
                <input name="joinCode" required placeholder="Pegar link o codigo" />
              </label>
              <label>
                Clave del viaje
                <input name="joinKey" required placeholder="Clave que paso el organizador" />
              </label>
              <label>
                Tu nombre
                <input name="joinName" required placeholder="Tu nombre" />
              </label>
              <label>
                Tu email
                <input name="joinEmail" required type="email" placeholder="tu@mail.com" />
              </label>
              {joinMessage && <p className="form-note">{joinMessage}</p>}
              <button className="secondary-button" type="submit">Entrar</button>
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
          onClick={() => copyText(`${location.origin}/?trip=${state.trip?.code} - clave: ${state.trip?.key}`)}
        >
          <CopyIcon />
        </button>
      </header>

      <section className="trip-card">
        <div>
          <p className="eyebrow">Clave del viaje</p>
          <h2>{state.trip.name}</h2>
          <p className="muted">Compartilo con link + clave: <strong>{state.trip.key}</strong></p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setActiveTab('group')}>
          Mi perfil
        </button>
      </section>

      <section className="summary-grid" aria-label="Resumen del viaje">
        <article>
          <span>Total gastado</span>
          <strong>{currency.format(tripTotal)}</strong>
        </article>
        <article>
          <span>Tu balance</span>
          <strong className={(balances[currentMember?.id || ''] || 0) >= 0 ? 'balance-positive' : 'balance-negative'}>
            {currency.format(balances[currentMember?.id || ''] || 0)}
          </strong>
        </article>
        <article>
          <span>Gastos</span>
          <strong>{state.expenses.length}</strong>
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
              <h2>Agregar gasto</h2>
            </div>
          </div>
          <form className="form-card" onSubmit={addExpense}>
            <label>
              Concepto
              <input name="expenseTitle" required placeholder="Super, nafta, cena..." />
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
            <ChipPicker members={state.members} selected={expenseParticipants} onChange={setExpenseParticipants} />
            <button className="primary-button" type="submit">Guardar gasto</button>
          </form>
          <div className="list">
            {state.expenses.length === 0 && <div className="empty-state">Todavia no hay gastos cargados.</div>}
            {state.expenses.slice().reverse().map((expense) => {
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
              <h2>Quien le paga a quien</h2>
            </div>
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
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
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
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </svg>
  )
}

function ChipPicker({
  members,
  selected,
  onChange,
}: {
  members: Member[]
  selected: string[]
  onChange: (selected: string[]) => void
}) {
  return (
    <fieldset>
      <legend>Participan</legend>
      <div className="chips">
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
