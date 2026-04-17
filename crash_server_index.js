const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://jtxvwzcolsbdviskhxpj.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const sleep = ms => new Promise(r => setTimeout(r, ms))

function genCrashPoint() {
  if (Math.random() < 0.04) return 1.00
  const r = Math.random()
  return Math.max(1.01, Math.round((0.99 / (1 - r)) * 100) / 100)
}

async function runLoop() {
  console.log('[G-Layer Crash Server] Iniciando...')

  while (true) {
    try {
      // 1. Limpiar rondas viejas que no terminaron
      await sb.from('crash_rounds')
        .update({ status: 'crashed' })
        .in('status', ['waiting', 'running'])

      // 2. Crear ronda nueva
      const crashAt = genCrashPoint()
      const { data: round, error } = await sb.from('crash_rounds')
        .insert({ crash_at: crashAt, status: 'waiting' })
        .select()
        .single()

      if (error) {
        console.error('[crash] Error creando ronda:', error.message)
        await sleep(3000)
        continue
      }

      console.log('[crash] Ronda #' + round.id + ' — crash en ' + crashAt.toFixed(2) + 'x')

      // 3. Fase de apuestas — 7 segundos
      await sleep(7000)

      // 4. Arrancar
      await sb.from('crash_rounds')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', round.id)

      console.log('[crash] Ronda #' + round.id + ' corriendo...')

      // 5. Esperar hasta el crash
      const duration = Math.max(1500, Math.log(crashAt) * 9000)
      await sleep(duration)

      // 6. Crashear
      await sb.from('crash_rounds')
        .update({ status: 'crashed' })
        .eq('id', round.id)

      console.log('[crash] Ronda #' + round.id + ' crasheó a ' + crashAt.toFixed(2) + 'x')

      // 7. Esperar 3s para que cashouts en vuelo lleguen a Supabase
      await sleep(3000)

      // 8. Resolver apuestas — el cliente ya escribió cashout_at al momento de cobrar
      const { data: bets } = await sb.from('crash_bets')
        .select('*')
        .eq('round_id', round.id)

      if (bets && bets.length) {
        for (const bet of bets) {
          if (bet.cashout_at !== null && bet.cashout_at < crashAt) {
            // Cobró antes del crash — acreditar
            const profit = Math.round(bet.stake * bet.cashout_at)
            await sb.from('crash_bets')
              .update({ profit: profit })
              .eq('id', bet.id)
            console.log('[crash] Cashout válido: ' + (bet.username || bet.user_id) + ' cobró a ' + bet.cashout_at + 'x → +' + profit + ' G')
          } else if (bet.cashout_at === null) {
            // No cobró — perdida
            await sb.from('crash_bets')
              .update({ profit: 0 })
              .eq('id', bet.id)
          }
          // Si cashout_at >= crashAt no debería pasar (el cliente no puede cobrar después del crash)
          // pero por las dudas no hacemos nada — queda sin resolver
        }
      }

      // 9. Pausa entre rondas
      await sleep(5000)

    } catch(e) {
      console.error('[crash] Error en loop:', e.message)
      await sleep(5000)
    }
  }
}

runLoop()
