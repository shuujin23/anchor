# Rilis Anchor 1.4 dan seterusnya

Repository update: https://github.com/shuujin23/anchor (public).
Token GitHub tidak disertakan dalam aplikasi. Data pengguna tidak diunggah ke repository.

## Rilis pertama dengan updater

1. Commit dan push perubahan ini ke repository tersebut.
2. Buka Actions → Build Windows release → Run workflow pada branch yang berisi perubahan.
3. Workflow menjalankan tes, build NSIS Windows x64, lalu membuat draft release v1.4.0.
4. Periksa draft berisi `Anchor-Setup-1.4.0.exe`, `.exe.blockmap`, dan `latest.yml`.
5. Publikasikan draft. Jangan mengganti file pada versi yang sudah dipublikasikan.
6. Keluar dari Anchor lama lewat tray, lalu install 1.4.0 sekali secara manual.

Versi 1.3 dan sebelumnya belum memiliki updater. Database tetap di `%APPDATA%/Anchor/anchor.db`.
Build installer lama melalui `create-installer.cjs` / `package-folder.cjs` tidak boleh dipakai lagi;
skrip tersebut sengaja menolak agar paket yang kehilangan dependensi/metadata updater tidak terkirim.

## Rilis berikutnya

Naikkan versi package.json dan package-lock.json, commit/push, lalu jalankan workflow yang sama.
Draft tidak ditawarkan sebagai update. Setelah dipublikasikan, aplikasi terpasang memeriksa
rilis saat startup (setelah 15 detik), setiap enam jam, atau melalui Pengaturan → Cek update.
User memilih Download update, lalu Install & restart. Menutup aplikasi tidak menginstal otomatis.
Updater tidak menawarkan prerelease atau downgrade. Backup terenkripsi tetap dianjurkan sebelum
menguji migrasi versi yang mengubah format data.

Untuk build lokal: Node 22+, `npm ci`, `npm test`, `npm run package`.
Perintah package hanya membangun, tidak mempublikasikan. GitHub Actions memakai GITHUB_TOKEN
sementara untuk membuat draft; jangan menaruh personal access token dalam source atau installer.

## Verifikasi

TypeScript dan build frontend lulus; 37 tes lulus termasuk consent download/install, error dan progress updater.
Build installer lokal belum selesai karena lingkungan pengerjaan menolak child process electron-builder
dengan `spawn EPERM`. Workflow Windows disediakan untuk membangun dengan lingkungan CI standar.
Belum ada rilis yang diunggah/dipublikasikan dan belum dilakukan tes upgrade nyata antardua versi terpasang.
Sebelum distribusi luas, uji 1.4.0 → versi lebih tinggi pada akun Windows uji dan pastikan data tetap ada.

Referensi: https://www.electron.build/docs/features/auto-update/
