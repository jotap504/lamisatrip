import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

if (existsSync('.env.local')) {
  const envFile = readFileSync('.env.local', 'utf8')
  envFile.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const [key, ...valueParts] = trimmed.split('=')
    if (key && process.env[key] === undefined) {
      process.env[key] = valueParts.join('=')
    }
  })
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  process.exit(1)
}

const runId = Date.now()
const tripKey = `clave-${runId}`
const ownerEmail = `lamisatrip.owner.${runId}@gmail.com`
const guestEmail = `lamisatrip.guest.${runId}@gmail.com`
const password = `Test-${runId}!`

function client() {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function adminClient() {
  if (!serviceRoleKey) return null
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function signUpAndIn(supabase, email, displayName) {
  const admin = adminClient()

  if (admin) {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })
    if (error && !error.message.includes('already been registered')) throw error
  } else {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })
    if (error) throw error
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
}

async function loadMembers(supabase, tripId) {
  const { data, error } = await supabase
    .from('app_trip_members')
    .select('id, profile:app_profiles(email, display_name, payment_alias)')
    .eq('trip_id', tripId)
    .order('joined_at')

  if (error) throw error
  return data
}

async function main() {
  const owner = client()
  const guest = client()

  console.log('1. Creando usuario organizador')
  await signUpAndIn(owner, ownerEmail, 'Organizador Test')

  console.log('2. Creando viaje')
  const { data: createdTrips, error: createError } = await owner.rpc('app_create_trip', {
    trip_name: `Viaje Test ${runId}`,
    trip_key: tripKey,
    display_name: 'Organizador Test',
  })
  if (createError) {
    if (createError.message.includes('app_create_trip')) {
      throw new Error('Falta ejecutar supabase/schema_auth.sql en el SQL Editor de Supabase.')
    }
    throw createError
  }

  const createdTrip = createdTrips[0]
  assert.ok(createdTrip.trip_id)
  assert.ok(createdTrip.invite_code)

  console.log('3. Creando usuario invitado')
  await signUpAndIn(guest, guestEmail, 'Invitado Test')

  console.log('4. Sumando invitado con codigo y clave')
  const { data: joinedTrips, error: joinError } = await guest.rpc('app_join_trip', {
    invite: createdTrip.invite_code,
    trip_key: tripKey,
    display_name: 'Invitado Test',
  })
  if (joinError) throw joinError

  assert.equal(joinedTrips[0].trip_id, createdTrip.trip_id)

  console.log('5. Verificando integrantes desde ambos usuarios')
  const ownerMembers = await loadMembers(owner, createdTrip.trip_id)
  const guestMembers = await loadMembers(guest, createdTrip.trip_id)
  assert.equal(ownerMembers.length, 2)
  assert.equal(guestMembers.length, 2)

  const ownerMember = ownerMembers.find((member) => member.profile.email === ownerEmail)
  const guestMember = ownerMembers.find((member) => member.profile.email === guestEmail)
  assert.ok(ownerMember)
  assert.ok(guestMember)

  console.log('6. Invitado carga alias para cobrar')
  const { data: guestProfile, error: profileError } = await guest
    .from('app_profiles')
    .select('id')
    .eq('email', guestEmail)
    .single()
  if (profileError) throw profileError

  const { error: aliasError } = await guest
    .from('app_profiles')
    .update({ payment_alias: 'invitado.test' })
    .eq('id', guestProfile.id)
  if (aliasError) throw aliasError

  console.log('7. Verificando etapa inicial')
  const { data: stages, error: stagesError } = await owner
    .from('app_expense_stages')
    .select('id, name, status')
    .eq('trip_id', createdTrip.trip_id)
  if (stagesError) throw stagesError
  assert.equal(stages.length, 1)
  assert.equal(stages[0].status, 'open')

  console.log('8. Organizador carga gasto dividido entre ambos')
  const { data: expense, error: expenseError } = await owner
    .from('app_expenses')
    .insert({
      trip_id: createdTrip.trip_id,
      stage_id: stages[0].id,
      title: 'Cena test',
      amount: 10000,
      payer_member_id: ownerMember.id,
      created_by_member_id: ownerMember.id,
    })
    .select('id')
    .single()
  if (expenseError) throw expenseError

  const { error: splitError } = await owner
    .from('app_expense_splits')
    .insert([
      { expense_id: expense.id, member_id: ownerMember.id, share_amount: 5000 },
      { expense_id: expense.id, member_id: guestMember.id, share_amount: 5000 },
    ])
  if (splitError) throw splitError

  console.log('9. Verificando que invitado ve el gasto')
  const { data: visibleExpenses, error: visibleError } = await guest
    .from('app_expenses')
    .select('id, stage_id, title, amount, splits:app_expense_splits(member_id)')
    .eq('trip_id', createdTrip.trip_id)
  if (visibleError) throw visibleError

  assert.equal(visibleExpenses.length, 1)
  assert.equal(visibleExpenses[0].stage_id, stages[0].id)
  assert.equal(visibleExpenses[0].title, 'Cena test')
  assert.equal(Number(visibleExpenses[0].amount), 10000)
  assert.equal(visibleExpenses[0].splits.length, 2)

  console.log('OK: crear viaje, sumarse, alias, gasto compartido y lectura por invitado funcionan.')
  console.log(`Codigo de viaje: ${createdTrip.invite_code}`)
  console.log(`Clave de prueba: ${tripKey}`)
}

main().catch((error) => {
  console.error('Fallo la prueba:', error.message)
  process.exit(1)
})
