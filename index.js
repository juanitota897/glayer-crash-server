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

      // 7. Esperar 2 segundos para que cashouts en vuelo lleguen primero
      await sleep(2000)

      // 8. Resolver apuestas sin cashout como perdidas
      // Solo afecta las que tienen profit null (no fueron cobradas)
      await sb.from('crash_bets')
        .update({ profit: 0 })
        .eq('round_id', round.id)
        .is('cashout_at', null)
        .is('profit', null)

      // 9. Pausa entre rondas
      await sleep(5000)

    } catch(e) {
      console.error('[crash] Error en loop:', e.message)
      await sleep(5000)
    }
  }
}

runLoop()
