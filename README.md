# Anchor — Personal Vault & Reminders

Aplikasi desktop lokal untuk Windows 10/11 x64. React + TypeScript + Electron, dengan SQLite melalui sql.js. Tidak membutuhkan MySQL, server web, atau Node.js setelah diinstal.

## Mulai menggunakan

1. Jalankan `release/Anchor-Setup-1.1.0.exe`, lalu buka Anchor dari desktop atau Start Menu.
2. Buka **Credentials → Buat vault**. Buat master password minimal 12 karakter. Tidak ada reset password.
3. Tambahkan credential, task, atau bill. Workspace awal kosong; tidak ada password default atau data contoh.
4. Di **Pengaturan**, aktifkan **Jalankan saat login Windows**, lalu simpan.
5. Gunakan **Tes Windows** untuk memeriksa notifikasi. Izinkan notifikasi Anchor pada pengaturan Windows dan periksa Do Not Disturb bila toast tidak muncul.
6. Jika memakai Discord, buat webhook pada channel privat melalui **Edit Channel → Integrations → Webhooks**. Buka vault, tempel URL webhook di Pengaturan, simpan, lalu klik **Tes Discord**. Aktifkan kanal Discord pada reminder yang diinginkan.

Installer belum ditandatangani dengan sertifikat penerbit. Aplikasi ini dibuat untuk penggunaan pribadi.

## Fitur

- Credential kategori Server, Billing, Akun, dan Lainnya. Field nama, username, alamat, password/token, dan catatan semuanya terenkripsi di database.
- Pencarian credential, edit/hapus, password generator 24 karakter, dan salin password. Tampilan password disembunyikan kembali setelah 15 detik.
- Daily, weekly, monthly, yearly, sekali, atau custom setiap N hari/minggu/bulan/tahun.
- Bill dengan nominal IDR/USD/EUR/SGD dan riwayat pembayaran per periode.
- Peringatan saat jatuh tempo atau sebelumnya: 30 menit, 1 jam, H-1, H-3, H-7.
- Pengulangan notifikasi setiap 5/15/30 menit, 1/4 jam, atau setiap hari sampai selesai atau jadwal dinonaktifkan.
- Snooze 30 menit dari daftar reminder.
- Notifikasi native Windows dan pesan ke channel Discord melalui webhook. Tombol selesai/snooze ada di aplikasi; belum ada tombol interaktif Discord.
- System tray, auto-start opsional saat login Windows, auto-lock vault, serta backup dan restore terenkripsi.

## Cara kerja periode

### Task tanpa deadline (baru di 1.1.0)

Di **Tasks → Tambah task**, pilih **Tanpa deadline — ulang sampai selesai**. Tentukan **Mulai pengingat** dan jadwal **Harian/Mingguan/Bulanan/Tahunan/Custom**. Waktu mulai menentukan kapan pengingat pertama muncul; itu bukan batas penyelesaian dan tidak ada tanggal akhir.

Contoh: Harian mulai 14 September pukul 09.00 mengirim pengingat setiap hari pukul 09.00, meskipun task belum dicentang. Klik **Selesai** sekali untuk menghentikan seluruh pengulangan task itu. Tidak ada periode baru setelah selesai. **Nonaktifkan** menjeda pengiriman sampai diaktifkan lagi; **Snooze** menunda pengiriman saat ini tanpa menggeser jam jadwal berikutnya.

Jika beberapa jadwal terlewat saat PC mati, Anchor mengirim satu pengingat susulan lalu melanjutkan jadwal berikutnya yang masih di masa depan. Task ini tidak dihitung terlambat dan tidak memiliki pengaturan H-1/H-3 atau interval ulang tambahan; frekuensinya mengikuti jadwal yang dipilih.

Task baru memakai mode tanpa deadline secara default. Task lama tetap memakai mode deadline. Untuk mengubah task lama, buka **Edit reminder → Mode task → Tanpa deadline**, periksa waktu mulai dan frekuensi, lalu simpan. Bill selalu memakai jatuh tempo.

### Task dengan deadline dan bill

**Selesai / Sudah dibayar** menyelesaikan satu periode. Untuk jadwal berulang, periode berikutnya dibuat berdasarkan tanggal jatuh tempo lama, bukan tanggal pembayaran. Jika beberapa periode menunggak, selesaikan masing-masing; aplikasi tidak otomatis menganggap periode yang terlewat sudah dibayar.

**Nonaktifkan** menghentikan pengiriman untuk seluruh jadwal sampai diaktifkan kembali. **Snooze** menunda notifikasi periode yang masih terbuka.

Tanggal 31 dijepit ke hari terakhir pada bulan yang lebih pendek, lalu kembali ke tanggal 31 pada bulan berikutnya. Jadwal 29 Februari kembali ke 29 Februari pada tahun kabisat. Jadwal memakai zona waktu lokal Windows. Periksa jadwal bila zona waktu Windows diubah.

Menutup jendela menyembunyikan aplikasi ke tray dan mengunci vault. Pilih **Keluar (hentikan reminder)** dari tray untuk menutup proses sepenuhnya. Reminder lokal membutuhkan Windows sudah login, aplikasi aktif, dan PC tidak sleep. Setelah restart/resume, jadwal terlewat diperiksa kembali setiap 15 detik, maksimal lima reminder per pemeriksaan. Tidak ada pengiriman saat PC mati.

Discord gagal dikirim akan dicoba lagi dengan jeda bertahap 2–30 menit. Keberhasilan kanal Windows disimpan agar retry Discord tidak mengulanginya. Seperti pengiriman jaringan pada umumnya, koneksi putus setelah server menerima pesan dapat menghasilkan duplikat pada retry. Toast Windows dapat disembunyikan oleh pengaturan sistem.

## Penyimpanan dan backup

Database ada di `%APPDATA%\Anchor\anchor.db`. Aplikasi berjalan sebagai pengguna Windows biasa. Uninstall mempertahankan folder data agar tidak menghapus vault.

- Credential: AES-256-GCM dengan nonce acak per enkripsi. Kunci diturunkan dari master password dengan scrypt dan salt acak.
- Master password tidak disimpan. Kunci sesi dibuang saat vault terkunci. Vault otomatis terkunci setelah 1/5/15/30 menit tanpa interaksi, saat Windows terkunci/suspend, atau saat jendela ditutup.
- Judul, catatan, nominal, jadwal, dan riwayat task/bill **tidak dienkripsi**, agar scheduler tetap bekerja saat vault terkunci. Jangan menaruh password di field reminder.
- Webhook Discord dilindungi dengan Electron safeStorage/Windows DPAPI agar dapat digunakan saat vault terkunci. Jangan membagikan URL webhook.
- Notifikasi hanya menyertakan jenis reminder, judul, dan jatuh tempo; tidak menyertakan credential, catatan, atau nominal.
- Clipboard dibersihkan setelah 30 detik atau vault dikunci jika isinya masih sama. Riwayat/sinkronisasi clipboard Windows atau clipboard manager lain dapat menyimpan salinannya.

Gunakan **Pengaturan → Ekspor backup** dengan password backup minimal 12 karakter. File `.anchor` berisi semua credential dan reminder serta 200 riwayat terbaru. Seluruh isi backup dienkripsi. Simpan password backup terpisah; backup dapat dipulihkan ke vault dengan master password berbeda.

**Pulihkan backup** menggabungkan item berdasarkan ID. Item yang sudah ada tetap dipertahankan, sehingga backup lama tidak membatalkan pembayaran yang sudah dicatat. Webhook Discord dan preferensi perangkat tidak ikut dibackup; atur ulang di perangkat baru. Menyalin database saja memerlukan master password asli dan tidak membuat webhook portabel.

Versi 1.1.0 tetap membaca database dan backup versi lama. Backup baru memakai format v2 agar mode tanpa deadline tidak disalahartikan oleh aplikasi 1.0.0; pulihkan backup v2 menggunakan Anchor 1.1.0 atau lebih baru.

## Pengembangan

Gunakan Node.js **22.12+** atau versi LTS lebih baru. Instalasi Node komputer tidak diubah oleh proyek ini.

```powershell
npm install
npm test
npm start
```

`npm run build` menjalankan pemeriksaan TypeScript, kompilasi main/preload, dan bundling React/CSS menggunakan esbuild. `npm run package` membangun installer Windows melalui electron-builder. Alternatif folder runnable: setelah build, jalankan `node scripts/package-folder.cjs`.

Untuk installer manual pada lingkungan yang membatasi proses build: jalankan `node scripts/create-installer.cjs`, kemudian compile `release/installer.nsi` menggunakan NSIS 3.12. Toolkit NSIS tidak disertakan dalam source. Ikon dapat diregenerasi menggunakan `python scripts/icon.py` dengan Pillow.

Source utama: `electron/store.ts` (SQLite/vault/backup), `electron/schedule.ts` (recurrence), `electron/scheduler.ts` (delivery/retry), `electron/main.ts` (Windows/tray/IPC), `src/main.tsx` (UI).

## Status verifikasi

- Build produksi dan pemeriksaan TypeScript berhasil.
- **27 pengujian inti lulus:** autentikasi/enkripsi/tampering, kalender akhir bulan/tahun kabisat, validasi, penyimpanan/restart, backup lintas master password, rollback saat disk gagal, snooze, retry per kanal, penyelesaian ketika pengiriman sedang berlangsung, serta task tanpa deadline, penghentian permanen, jadwal terlewat, perubahan mode, dan kompatibilitas data lama.
- Dashboard serta form task custom dan bill diperiksa melalui preview browser dengan adapter data uji. Preview bukan backend aplikasi yang dikirim.
- Jendela Electron dan toast Windows belum dapat diverifikasi end-to-end di lingkungan pengerjaan karena batasan sandbox. Discord live belum diuji karena webhook pengguna belum diisi. Tombol tes disediakan di Pengaturan untuk verifikasi setelah instalasi.

## Referensi

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Windows notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)
- [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Discord webhook](https://docs.discord.com/developers/resources/webhook)
- [sql.js](https://sql.js.org/documentation/)

## Backup otomatis — versi 1.2.0

Buka Pengaturan → Backup otomatis ke storage eksternal. Aktifkan, pilih folder yang sudah disinkronkan Google Drive for desktop (atau drive eksternal), pilih harian/mingguan/bulanan dan jam lokal, masukkan master password vault, lalu simpan. Backup pertama langsung dibuat. Memilih folder biasa tidak otomatis membuatnya tersinkron ke Google Drive.

Backup berjalan saat vault terkunci selama Anchor berjalan dan PC aktif. Jadwal terlewat dijalankan sekali saat aplikasi aktif kembali. Storage yang terputus dicoba ulang setelah 15 menit. Tanggal 29–31 disesuaikan ke akhir bulan pendek. Setiap file memiliki nama unik; backup lama tidak dihapus otomatis.

File otomatis memakai format v3 dan dipulihkan dengan master password vault asal saat file dibuat, menggunakan Anchor 1.2.0 atau lebih baru. Master password dan kunci pembuka vault tidak disimpan untuk scheduler; hanya kunci enkripsi backup terpisah yang dilindungi safeStorage sistem operasi. Backup tidak membuka credential saat vault terkunci. Backup manual tetap v2 dengan password pilihan pengguna; impor v1/v2 tetap didukung. Preferensi perangkat dan webhook tidak ikut backup.

Status berhasil menunjukkan file sudah ditulis dan dibaca ulang di folder tujuan. Upload cloud ditangani Google Drive for desktop dan harus diperiksa di aplikasi tersebut. Tidak ada akun Google yang dihubungkan atau backup cloud yang diaktifkan otomatis oleh installer.

Validasi versi 1.2.0: build TypeScript/produksi berhasil; seluruh 34 tes lulus, termasuk kalender backup, pemulihan lintas master password, vault terkunci, restart/catch-up, storage terputus/retry, job bersamaan dan kegagalan kunci OS. Sinkronisasi Google Drive live belum diuji.

Panduan resmi: [Sinkronisasi Google Drive for desktop](https://support.google.com/drive/answer/13401938?hl=en).

## Interval singkat — versi 1.3.0

Pada form reminder, pilih perulangan Custom, isi Setiap (1–365), lalu pilih detik, menit, atau jam. Contoh: setiap 30 detik, 10 menit, atau 2 jam. Untuk mengulang otomatis sampai selesai, gunakan Task tanpa deadline. Pada mode deadline, perulangan menentukan periode berikutnya setelah selesai; opsi ulang notifikasi sampai selesai tetap memakai pilihan interval menit yang tersedia.

Scheduler memeriksa setiap satu detik. Pengiriman mengikuti ketersediaan Windows/Discord dan bukan timer real-time dengan jaminan presisi. Aplikasi harus berjalan dan PC aktif. Jadwal interval singkat yang terlewat dihitung langsung dari waktu awal, tanpa mengirim seluruh backlog. Tanggal mulai dan tampilan jadwal kini mendukung detik.
Verifikasi 1.3.0: build produksi/TypeScript berhasil dan pengujian terakhir lulus 36/36. Pengiriman Windows/Discord live untuk interval singkat belum diuji di lingkungan pengerjaan.
