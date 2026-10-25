import { Plus } from 'lucide-react';

export default function Accounts({
  isAdmin,
  profile,
  users,
  newAccount,
  setNewAccount,
  accountMessage,
  createAccount,
  showAddUserPanel,
  setShowAddUserPanel,
  showUsersPanel,
  setShowUsersPanel,
  userRoleEdits,
  setUserRoleEdits,
  savedRoles,
  setSavedRoles,
  updateUserRole,
  deleteUser,
}) {
  return (
    <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">User management</h2>
          <p className="text-slate-400 mt-1">Use this panel to create and manage technician/client accounts.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddUserPanel((prev) => !prev)}
          className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition"
        >
          {showAddUserPanel ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {showAddUserPanel && (
        <>
        <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Create user account</h2>
          <p className="text-slate-400 mt-1">Create a technician or client login directly from the admin panel.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <input
          value={newAccount.name}
          onChange={(e) => setNewAccount((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Full name"
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
        />
        <input
          value={newAccount.email}
          onChange={(e) => setNewAccount((prev) => ({ ...prev, email: e.target.value }))}
          placeholder="Email"
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
        />
        <input
          type="password"
          value={newAccount.password}
          onChange={(e) => setNewAccount((prev) => ({ ...prev, password: e.target.value }))}
          placeholder="Account password"
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
        />
        <select
          value={newAccount.role}
          onChange={(e) => setNewAccount((prev) => ({ ...prev, role: e.target.value }))}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
        >
          <option value="tech">Technician</option>
          <option value="client">Client</option>
        </select>
      </div>

      {newAccount.role === 'tech' && (
        <div className="grid gap-4 md:grid-cols-2">
          <input
            value={newAccount.phone}
            onChange={(e) => setNewAccount((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="Phone"
            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
          />
          <input
            value={newAccount.location}
            onChange={(e) => setNewAccount((prev) => ({ ...prev, location: e.target.value }))}
            placeholder="Base location"
            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
          />
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <input
          type="password"
          value={newAccount.adminPassword}
          onChange={(e) => setNewAccount((prev) => ({ ...prev, adminPassword: e.target.value }))}
          placeholder="Your own password"
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
        />
        <div className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-400 flex items-center">
          This is required to restore your session after creating the new account.
        </div>
      </div>

      {accountMessage && <div className="rounded-2xl bg-violet-900/50 p-3 text-violet-200">{accountMessage}</div>}
      <button onClick={createAccount} type="button" className="rounded-2xl bg-indigo-600 px-5 py-3 text-white font-semibold hover:bg-indigo-500 transition flex items-center justify-center gap-2">
        <Plus size={16} /> Create account
      </button>
    </section>

    {isAdmin && (
    <section className="rounded-3xl bg-slate-950/60 border border-slate-700 p-6 grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Existing users</h2>
          <p className="text-slate-400 mt-1">Manage role assignments and remove users from app access.</p>
        </div>
        <button type="button" onClick={() => setShowUsersPanel((prev) => !prev)} className="rounded-2xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
          {showUsersPanel ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {!showUsersPanel ? null : users.length === 0 ? (
        <div className="rounded-2xl bg-slate-900 p-4 text-slate-400">No users found.</div>
      ) : (
        <div className="space-y-3">
          {users.map((userItem) => (
            <div key={userItem.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
              <div className="grid gap-3 md:grid-cols-[1.5fr_1.2fr_auto_auto] md:items-center">
                <div>
                  <div className="font-semibold text-slate-100">{userItem.displayName || 'Unnamed user'}</div>
                  <div className="text-slate-400 text-sm">{userItem.email || 'No email'}</div>
                  <div className="text-slate-500 text-xs mt-1">UID: {userItem.uid || userItem.id}</div>
                </div>

                <select
                  value={userRoleEdits[userItem.id] || userItem.role || 'client'}
                  onChange={(e) => setUserRoleEdits((prev) => ({ ...prev, [userItem.id]: e.target.value }))}
                  disabled={userItem.id === (profile?.uid || profile?.id) || savedRoles[userItem.id] !== false}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2 text-slate-100"
                >
                  <option value="admin">Admin</option>
                  <option value="adminAssistant">Admin Assistant</option>
                  <option value="tech">Technician</option>
                  <option value="seniorConsultant">Senior Consultant</option>
                  <option value="client">Client</option>
                </select>

                {savedRoles[userItem.id] !== false ? (
                  <button
                    type="button"
                    onClick={() => setSavedRoles((prev) => ({ ...prev, [userItem.id]: false }))}
                    className="rounded-2xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500 transition"
                  >
                    Edit role
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateUserRole(userItem)}
                    disabled={userItem.id === (profile?.uid || profile?.id)}
                    className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save role
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => deleteUser(userItem.id)}
                  disabled={userItem.id === (profile?.uid || profile?.id)}
                  className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
    )}
        </>
      )}
    </section>
  );
}
