const path = require('path'),
  fs = require('fs'),
  assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--disable-gpu'],
  })
  const page = await browser.newPage({
    baseURL: process.env.STUDIO_TEST_URL || 'http://127.0.0.1:3001',
    viewport: { width: 1440, height: 1000 },
  })
  const errors = []
  const projectName = `QA · RefMod workspace ${Date.now()}`
  page.setDefaultTimeout(60000)
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 350))
  })
  await page.addInitScript(() => localStorage.setItem('h3_welcome_seen_v1', '1'))
  try {
    await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:3001', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })
    console.log('INITIAL', (await page.locator('body').innerText()).slice(0, 700))
    await page.locator('textarea').first().waitFor({ timeout: 90000 })
    await page.getByRole('button', { name: 'RefMods', exact: true }).click({ timeout: 30000 })
    await page.getByRole('heading', { name: 'RefMods', exact: true }).waitFor({ timeout: 90000 })
    await page.screenshot({ path: 'data/refmods-library-qa.png', fullPage: true })
    const lib = await page.request.get('/api/refmods')
    assert.equal(lib.status(), 200)
    const library = await lib.json()
    console.log('LIBRARY', JSON.stringify(library).slice(0, 400))
    const created = await page.request.post('/api/refmods/projects', {
      data: { name: projectName },
    })
    assert.equal(created.status(), 200)
    const { project } = await created.json()
    const image = await require('sharp')({
      create: { width: 128, height: 192, channels: 3, background: '#40a0e0' },
    })
      .png()
      .toBuffer()
    const uploaded = await page.request.post('/api/refmods/projects?id=' + project.id, {
      multipart: { file: { name: 'qa-reference.png', mimeType: 'image/png', buffer: image } },
    })
    assert.equal(uploaded.status(), 200)
    const source = await uploaded.json()
    project.sources = [
      {
        id: 'qa-source',
        kind: 'image',
        name: 'QA portrait',
        file: source.file,
        start: 0,
        end: null,
        includeAudio: false,
      },
    ]
    const saved = await page.request.put('/api/refmods/projects', { data: { project } })
    assert.equal(saved.status(), 200)
    const changed = await page.request.put('/api/refmods/projects', { data: { project } })
    assert.equal(changed.status(), 400)
    console.log('PROJECT optimistic concurrency passed')
    await page
      .getByRole('button', { name: 'Обновить', exact: true })
      .count()
      .then(async (n) => {
        if (n) await page.getByRole('button', { name: 'Обновить', exact: true }).first().click()
      })
    await page.getByRole('button', { name: 'Мастерская', exact: true }).click()
    // Refresh from the server after API creation without touching the installed studio's browser state.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('textarea').first().waitFor()
    await page.getByRole('button', { name: 'RefMods', exact: true }).click()
    await page.getByRole('button', { name: 'Мастерская', exact: true }).click()
    await page.getByRole('button').filter({ hasText: projectName }).click()
    await page.getByRole('button', { name: 'Нарисовать маску', exact: true }).click()
    await page.getByRole('dialog', { name: 'Маска референса' }).waitFor()
    await page.screenshot({ path: 'data/refmods-mask-qa.png', fullPage: true })
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.getByLabel('Описание RefMod').fill('QA project changes')
    await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click()
    await page.getByRole('button', { name: 'Сохранено', exact: true }).waitFor()
    await page.screenshot({ path: 'data/refmods-workshop-qa.png', fullPage: true })
    await page.getByRole('button', { name: 'Генерация', exact: true }).click()
    await page.getByRole('button', { name: /Используемые RefMods/ }).click()
    await page.getByLabel('Имя набора').fill('QA empty set')
    await page.getByRole('button', { name: 'Сохранить набор', exact: true }).click()
    await page.getByRole('button', { name: 'Продление', exact: true }).click()
    assert.equal(await page.getByLabel('Имя набора').count(), 1)
    await page.getByRole('button', { name: 'Генерация', exact: true }).click()
    const first = library.entries[0]
    await page.getByLabel('Добавить RefMod').selectOption(first.id)
    await page.getByLabel('Добавить RefMod').locator('..').getByRole('button').first().click()
    assert.equal(await page.getByLabel(`Использовать ${first.name}`, { exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Продление', exact: true }).click()
    assert.equal(await page.getByLabel(`Использовать ${first.name}`, { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Генерация', exact: true }).click()
    assert.equal(await page.getByLabel(`Использовать ${first.name}`, { exact: true }).count(), 1)
    const submissions = []
    await page.route('**/api/comfy/generate', async route => {
      submissions.push(route.request().postDataJSON())
      await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'QA: intercepted before GPU submission'})})
    })
    await page.locator('textarea').first().fill('QA reference <Picture 1> turns slowly.')
    await page.getByRole('button', {name:'A/B: без RefMods / с RefMods',exact:true}).click()
    for(let i=0;i<60 && submissions.length<2;i++) await page.waitForTimeout(250)
    assert.equal(submissions.length,2)
    assert.equal(submissions[0].seed,submissions[1].seed)
    assert.equal(submissions[0].prompt,submissions[1].prompt)
    assert.equal(submissions[0].refMods.items.length,0)
    assert.equal(submissions[1].refMods.items.length,1)
    assert.equal(submissions[0].refModComparison.id,submissions[1].refModComparison.id)
    console.log('A/B identical seed/prompt and separate target sets passed')
    assert.deepEqual(errors, [])
    console.log('BROWSER UI checks passed')
    console.log('QA_PROJECT', project.id)
  } catch (e) {
    console.log('FAILURE BODY', (await page.locator('body').innerText()).slice(0, 3000))
    await page.screenshot({ path: 'data/refmods-browser-failure.png', fullPage: true })
    throw e
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
