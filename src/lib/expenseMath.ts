export type ExpenseMember = {
  id: string
  name: string
  email?: string
  alias?: string
}

export type SplitExpense = {
  id: string
  title: string
  amount: number
  payerId: string
  participantIds: string[]
  createdAt?: string
}

export type SettlementRow<TMember extends ExpenseMember = ExpenseMember> = {
  from: TMember
  to: TMember
  amount: number
}

export function totalSpent(expenses: SplitExpense[]) {
  return expenses.reduce((sum, expense) => sum + expense.amount, 0)
}

export function balanceByMember<TMember extends ExpenseMember>(members: TMember[], expenses: SplitExpense[]) {
  const balances = Object.fromEntries(members.map((member) => [member.id, 0]))

  expenses.forEach((expense) => {
    if (balances[expense.payerId] === undefined) balances[expense.payerId] = 0
    balances[expense.payerId] += expense.amount

    if (!expense.participantIds.length) return

    const share = expense.amount / expense.participantIds.length
    expense.participantIds.forEach((id) => {
      if (balances[id] === undefined) balances[id] = 0
      balances[id] -= share
    })
  })

  return balances
}

export function settlementRows<TMember extends ExpenseMember>(
  members: TMember[],
  expenses: SplitExpense[],
): Array<SettlementRow<TMember>> {
  const balances = balanceByMember(members, expenses)
  const people = members.map((member) => ({ ...member, balance: balances[member.id] || 0 }))
  const debtors = people.filter((person) => person.balance < -0.5).sort((a, b) => a.balance - b.balance)
  const creditors = people.filter((person) => person.balance > 0.5).sort((a, b) => b.balance - a.balance)
  const rows: Array<SettlementRow<TMember>> = []
  let debtorIndex = 0
  let creditorIndex = 0

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amount = Math.min(-debtors[debtorIndex].balance, creditors[creditorIndex].balance)
    rows.push({
      from: debtors[debtorIndex] as TMember,
      to: creditors[creditorIndex] as TMember,
      amount,
    })
    debtors[debtorIndex].balance += amount
    creditors[creditorIndex].balance -= amount
    if (Math.abs(debtors[debtorIndex].balance) < 0.5) debtorIndex += 1
    if (Math.abs(creditors[creditorIndex].balance) < 0.5) creditorIndex += 1
  }

  return rows
}
