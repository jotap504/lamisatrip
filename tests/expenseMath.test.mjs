import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { balanceByMember, settlementRows, totalSpent } from '../.test-build/expenseMath.js'

const members = [
  { id: 'ana', name: 'Ana', alias: 'ana.mp' },
  { id: 'bruno', name: 'Bruno', alias: 'bruno.mp' },
  { id: 'cami', name: 'Cami', alias: 'cami.mp' },
  { id: 'diego', name: 'Diego', alias: 'diego.mp' },
]

function roundedBalances(expenses) {
  const balances = balanceByMember(members, expenses)
  return Object.fromEntries(Object.entries(balances).map(([id, value]) => [id, Math.round(value)]))
}

function simplifiedSettlements(expenses) {
  return settlementRows(members, expenses).map((row) => ({
    from: row.from.id,
    to: row.to.id,
    amount: Math.round(row.amount),
  }))
}

describe('expense math', () => {
  it('calculates zero totals and no settlements for an empty trip', () => {
    assert.equal(totalSpent([]), 0)
    assert.deepEqual(roundedBalances([]), {
      ana: 0,
      bruno: 0,
      cami: 0,
      diego: 0,
    })
    assert.deepEqual(simplifiedSettlements([]), [])
  })

  it('splits one expense between all participants', () => {
    const expenses = [
      {
        id: 'e1',
        title: 'Super',
        amount: 40000,
        payerId: 'ana',
        participantIds: ['ana', 'bruno', 'cami', 'diego'],
      },
    ]

    assert.equal(totalSpent(expenses), 40000)
    assert.deepEqual(roundedBalances(expenses), {
      ana: 30000,
      bruno: -10000,
      cami: -10000,
      diego: -10000,
    })
    assert.deepEqual(simplifiedSettlements(expenses), [
      { from: 'bruno', to: 'ana', amount: 10000 },
      { from: 'cami', to: 'ana', amount: 10000 },
      { from: 'diego', to: 'ana', amount: 10000 },
    ])
  })

  it('splits an expense only between selected participants', () => {
    const expenses = [
      {
        id: 'e1',
        title: 'Padel',
        amount: 12000,
        payerId: 'bruno',
        participantIds: ['bruno', 'diego'],
      },
    ]

    assert.deepEqual(roundedBalances(expenses), {
      ana: 0,
      bruno: 6000,
      cami: 0,
      diego: -6000,
    })
    assert.deepEqual(simplifiedSettlements(expenses), [
      { from: 'diego', to: 'bruno', amount: 6000 },
    ])
  })

  it('combines all-participant and partial expenses into minimal final payments', () => {
    const expenses = [
      {
        id: 'e1',
        title: 'Alojamiento',
        amount: 80000,
        payerId: 'ana',
        participantIds: ['ana', 'bruno', 'cami', 'diego'],
      },
      {
        id: 'e2',
        title: 'Cena',
        amount: 24000,
        payerId: 'cami',
        participantIds: ['ana', 'cami', 'diego'],
      },
      {
        id: 'e3',
        title: 'Nafta auto 2',
        amount: 18000,
        payerId: 'diego',
        participantIds: ['bruno', 'diego'],
      },
    ]

    assert.equal(totalSpent(expenses), 122000)
    assert.deepEqual(roundedBalances(expenses), {
      ana: 52000,
      bruno: -29000,
      cami: -4000,
      diego: -19000,
    })
    assert.deepEqual(simplifiedSettlements(expenses), [
      { from: 'bruno', to: 'ana', amount: 29000 },
      { from: 'diego', to: 'ana', amount: 19000 },
      { from: 'cami', to: 'ana', amount: 4000 },
    ])
  })

  it('handles a one-person trip without creating debt', () => {
    const solo = [{ id: 'ana', name: 'Ana' }]
    const expenses = [
      {
        id: 'e1',
        title: 'Cafe',
        amount: 2500,
        payerId: 'ana',
        participantIds: ['ana'],
      },
    ]

    assert.deepEqual(balanceByMember(solo, expenses), { ana: 0 })
    assert.deepEqual(settlementRows(solo, expenses), [])
  })

  it('keeps a large group balanced after many expenses', () => {
    const bigMembers = Array.from({ length: 24 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Persona ${index + 1}`,
    }))
    const expenses = Array.from({ length: 48 }, (_, index) => ({
      id: `e${index + 1}`,
      title: `Gasto ${index + 1}`,
      amount: 2400 + index * 100,
      payerId: bigMembers[index % bigMembers.length].id,
      participantIds: index % 3 === 0 ? bigMembers.slice(0, 12).map((member) => member.id) : bigMembers.map((member) => member.id),
    }))

    const balances = balanceByMember(bigMembers, expenses)
    const net = Object.values(balances).reduce((sum, value) => sum + value, 0)
    const settlementTotal = settlementRows(bigMembers, expenses).reduce((sum, row) => sum + row.amount, 0)

    assert.equal(totalSpent(expenses), 228000)
    assert.ok(Math.abs(net) < 0.001)
    assert.ok(settlementTotal > 0)
  })
})
