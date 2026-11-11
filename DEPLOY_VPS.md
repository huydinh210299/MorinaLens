# Deploy MorinaLens lên VPS đang chạy Morina admin

Repository: [huydinh210299/MorinaLens](https://github.com/huydinh210299/MorinaLens) · nhánh `main` · tên miền `lens.morina.click`.

Hướng dẫn dựa trên [workflow hiện tại](.github/workflows/deploy.yml): GitHub Actions → SSH → Node.js/PM2 → Nginx → HTTPS. Morina đã hoạt động trên VPS; không cần dựng lại VPS hoặc chạy script Docker cũ để thêm Lens.

Các ví dụ dùng tài khoản SSH `deploy`. Nếu `VPS_USER` khác, thay `deploy` bằng đúng tài khoản đó. `IP_VPS`, `HOST_CLUSTER` và các giá trị viết hoa khác là chỗ cần thay bằng thông tin thật. Tài liệu không chứa thông tin đăng nhập thật.

## 1. Hai web chạy song song

| Thành phần | Morina admin | MorinaLens |
| --- | --- | --- |
| Repository | `huydinh210299/Morina` | `huydinh210299/MorinaLens` |
| Thư mục trên VPS | `/opt/rental-shop` | `/opt/morina-lens` |
| Tiến trình PM2 | `rental-shop` | `morina-lens` |
| Cổng ứng dụng | `3000` | `3100` |
| Database | Database Morina đang dùng; mẫu cấu hình là `rental-shop` | `morina-lens` |
| Cookie mặc định | `rentalshop_token` | `morina_lens_token` |
| File môi trường | `/opt/rental-shop/shared/.env` | `/opt/morina-lens/shared/.env` |
| Site Nginx theo hướng dẫn | `/etc/nginx/sites-available/rental-shop` | `/etc/nginx/sites-available/morina-lens` |

- Deploy Morina chỉ thay tiến trình `rental-shop`; deploy Lens chỉ thay `morina-lens`. Dependencies, release và file upload tạm cũng tách riêng.
- Cả hai workflow hiện tại không restart toàn bộ PM2, Nginx hoặc VPS. Giữ nguyên site Nginx đang phục vụ Morina.
- Web đang deploy có thể gián đoạn lúc tiến trình cũ bị dừng và tiến trình mới khởi động. Web còn lại tiếp tục chạy khi VPS đủ tài nguyên và cấu hình riêng được giữ đúng.
- Hai web vẫn chia sẻ CPU, RAM, ổ đĩa, Nginx và có thể cùng tài nguyên cluster Atlas; không phải cách ly hoàn toàn. VPS ít tài nguyên nên deploy lần lượt.
- Có thể dùng chung SSH key nếu cùng tài khoản VPS. Database, database user và `JWT_SECRET` nên riêng cho từng web.

## 2. Kiểm tra VPS và chuẩn bị quyền thư mục

**PowerShell trên Windows:**

```powershell
ssh deploy@IP_VPS
```

Nếu cần chỉ định private key, dùng `ssh -i DUONG_DAN_PRIVATE_KEY deploy@IP_VPS`.

**Trong phiên SSH trên VPS:**

```bash
whoami
node --version
npm --version
pm2 --version
pm2 status
sudo systemctl status nginx --no-pager
free -h
df -h /
```

Cần Node.js 22 trở lên, PM2 và Nginx hoạt động. Morina hiện tại vẫn cần giữ trạng thái `online`. Các lệnh `node`, `npm`, `pm2` phải khả dụng cả trong phiên SSH không tương tác mà Actions sử dụng.

Tạo thư mục thuộc quyền tài khoản deploy, kể cả các thư mục con:

```bash
sudo install -d -o deploy -g "$(id -gn deploy)" -m 755 \
  /opt/morina-lens \
  /opt/morina-lens/releases \
  /opt/morina-lens/shared

ls -ld /opt/morina-lens /opt/morina-lens/releases /opt/morina-lens/shared
```

Cột owner phải là tài khoản `VPS_USER`. Lệnh trên cũng xử lý lỗi `mkdir ... Permission denied` khi deploy lần đầu. Không cần `chmod 777`.

```bash
sudo ss -ltnp 'sport = :3100'
```

Trước lần cài Lens đầu tiên, cổng 3100 cần trống. Nếu có tiến trình, xác định nó trước khi tiếp tục. Lens chỉ nghe trên `127.0.0.1:3100`; không mở cổng này ra Internet.

Chạy các lệnh PM2 bằng đúng tài khoản deploy. Không thêm `sudo` vào `pm2`, vì PM2 của root có danh sách tiến trình khác.

## 3. Database và database user trên MongoDB Atlas

| Loại tài khoản | Mục đích | Cách tạo |
| --- | --- | --- |
| Atlas database user | Cho ứng dụng kết nối MongoDB | Tạo trong Database Access |
| Admin website | Đăng nhập giao diện Lens | App tự seed từ `ADMIN_USERNAME` và `ADMIN_PASSWORD` |

Collection `users` trong Data Explorer lưu tài khoản website. Không thêm thủ công mật khẩu dạng văn bản vào collection này.

Trong Atlas:

1. Mở **Security → Database & Network Access** hoặc **Database Access**.
2. Trong **Database Users**, chọn **Add New Database User**.
3. Chọn **Password**, nhập username ví dụ `morina_lens_app`, tạo và lưu mật khẩu.
4. Trong **Specific Privileges**, thêm quyền `readWrite` cho database `morina-lens`; để trống collection để áp dụng toàn database. Bỏ quyền rộng như `readWriteAnyDatabase` nếu có.
5. Không bật tài khoản tạm thời cho ứng dụng. Lưu user.
6. Trong Network Access/IP Access List, cho phép IP public của VPS. Nếu cùng project Atlas với Morina, IP có thể đã có.
7. Lấy đúng hostname cluster từ **Cluster → Connect → Drivers**.

URI mẫu:

```text
mongodb+srv://morina_lens_app:ENCODED_PASSWORD@HOST_CLUSTER/morina-lens?retryWrites=true&w=majority
```

Mật khẩu trong URI phải URL encode nếu có ký tự đặc biệt. Path bắt buộc là `/morina-lens`; Lens từ chối tên database khác. Có thể dùng cùng cluster với Morina, không cần cluster mới.

Không cần import dữ liệu local. Nếu chưa có database/collection, lần seed đầu sẽ tạo khi ghi dữ liệu. Nếu đã tạo `morina-lens` và collection `users` trống thì giữ nguyên.

Morina admin hiện chưa kiểm tra cố định tên database như Lens. Vì Morina chạy migration/seed, phải giữ URI Morina trỏ đúng database hiện tại và giới hạn quyền database user của mỗi app.

## 4. SSH key và chuyển sang máy mới

Public key nằm trong `~/.ssh/authorized_keys` trên VPS. Private key nằm trên máy giữ key và trong GitHub Secrets. Không khôi phục được private key từ public key; GitHub cũng không cho xem lại secret đã lưu.

### 4.1. Nếu vẫn còn private key Morina

Theo hướng dẫn Morina ban đầu, file tên `rental_shop_github_actions`. Trên Windows:

```powershell
Test-Path "$env:USERPROFILE\.ssh\rental_shop_github_actions"
```

Nếu trả về `True`, copy private key:

```powershell
Get-Content "$env:USERPROFILE\.ssh\rental_shop_github_actions" -Raw | Set-Clipboard
```

Dán vào secret `VPS_SSH_KEY` của repo Lens. Nếu cùng tài khoản VPS và key đã đăng nhập được, không cần thêm public key lần nữa.

### 4.2. Tạo key mới khi mất private key hoặc đổi máy

Giữ phiên SSH hiện tại mở tới khi key mới hoạt động. Nếu không còn đăng nhập SSH được, dùng Console/Terminal của nhà cung cấp VPS.

**PowerShell trên Windows mới:**

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -C "github-actions-morina" -f "$env:USERPROFILE\.ssh\morina_vps_actions"
```

Nhấn Enter hai lần ở phần passphrase để dùng với workflow hiện tại, vốn chưa hỗ trợ nhập passphrase. Nếu file đã tồn tại, không ghi đè khi chưa xác định đó là key gì; chọn tên file mới và dùng thống nhất trong các lệnh sau.

Copy **public key**:

```powershell
Get-Content "$env:USERPROFILE\.ssh\morina_vps_actions.pub" -Raw | Set-Clipboard
```

**Trên VPS, dưới đúng tài khoản `VPS_USER`:**

```bash
whoami
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
```

Nếu đang là root mà `VPS_USER=deploy`, chạy `su - deploy` trước các lệnh tạo/sửa file SSH. Thêm public key mới vào một dòng cuối file, giữ các key cũ. Trong nano: `Ctrl+O`, Enter để lưu, `Ctrl+X` để thoát.

```bash
chmod 600 ~/.ssh/authorized_keys
```

**Mở PowerShell khác trên Windows để kiểm tra:**

```powershell
ssh -o IdentitiesOnly=yes -o PreferredAuthentications=publickey -i "$env:USERPROFILE\.ssh\morina_vps_actions" deploy@IP_VPS
```

Khi đăng nhập thành công, copy **private key**:

```powershell
Get-Content "$env:USERPROFILE\.ssh\morina_vps_actions" -Raw | Set-Clipboard
```

Cập nhật `VPS_SSH_KEY` trong **cả repo Morina và MorinaLens** nếu muốn cả hai dùng key mới. Dán toàn bộ key, gồm dòng `BEGIN OPENSSH PRIVATE KEY` và `END OPENSSH PRIVATE KEY`. Không đưa private key lên VPS, vào Git hoặc vào chat.

Chỉ gỡ đúng public key cũ khỏi `authorized_keys` sau khi đã kiểm tra đăng nhập và deploy thành công bằng key mới. Việc thêm key không cần restart web. Giữ bản sao private key ở nơi lưu trữ an toàn để dùng khi đổi máy.

## 5. GitHub Secrets cho Lens

Mở **MorinaLens → Settings → Secrets and variables → Actions → Secrets → New repository secret**.

| Name | Nội dung ô Secret |
| --- | --- |
| `VPS_HOST` | IP/hostname VPS giống Morina; workflow dùng cổng SSH mặc định 22 |
| `VPS_USER` | Tài khoản SSH sở hữu thư mục và chạy PM2, ví dụ `deploy` |
| `VPS_SSH_KEY` | Toàn bộ private key tương ứng public key đã cài trên VPS |
| `APP_ENV_FILE` | Nguyên khối cấu hình production bên dưới |

Ba secret `VPS_*` có thể giống Morina. `APP_ENV_FILE` phải là cấu hình riêng cho Lens:

```dotenv
PORT=3100
NODE_ENV=production
MONGODB_URI=mongodb+srv://morina_lens_app:ENCODED_PASSWORD@HOST_CLUSTER/morina-lens?retryWrites=true&w=majority
JWT_SECRET=REPLACE_WITH_A_NEW_RANDOM_SECRET
COOKIE_NAME=morina_lens_token
ADMIN_USERNAME=admin
ADMIN_PASSWORD=REPLACE_WITH_A_STRONG_ADMIN_PASSWORD
```

Thay hết giá trị mẫu. Secret chứa nhiều dòng như trên, không gồm dấu backtick Markdown. Workflow đọc cả file; không cần tạo secret `MONGODB_URI` riêng.

Tạo JWT secret mới trên VPS:

```bash
openssl rand -hex 32
```

Dùng kết quả cho Lens, không dùng lại secret của Morina. Mật khẩu database và mật khẩu đăng nhập website là hai giá trị độc lập.

Workflow ghi `/opt/morina-lens/shared/.env` với quyền `600`, tạo symlink `.env` trong từng release. Không cần copy `.env` local lên VPS. Khi đổi cấu hình lâu dài, cập nhật GitHub Secret vì deploy tiếp theo sẽ ghi lại file này.

Job dùng environment `production`. Nếu environment có secret trùng tên, kiểm tra **Settings → Environments → production** để tránh giá trị cũ ghi đè repository secret. Nếu có quy tắc yêu cầu reviewer, job sẽ chờ phê duyệt theo cấu hình đó.

## 6. Deploy lần đầu và bật tự deploy

### 6.1. Chuẩn bị phiên bản mã nguồn

Actions chỉ deploy code đã có trên GitHub, không lấy thay đổi chưa commit trên máy. Trong PowerShell:

```powershell
cd D:\Morina\MorinaLens
git status
npm run check
```

Kiểm tra thay đổi cần triển khai, commit các file liên quan rồi push lên `main`. Không đưa `.env`, private key hoặc dữ liệu thật vào commit. Đây là các bước dành cho người triển khai; hướng dẫn không tự commit/push.

### 6.2. Chạy thủ công lần đầu

1. Mở [Actions → Deploy MorinaLens to VPS](https://github.com/huydinh210299/MorinaLens/actions/workflows/deploy.yml).
2. Tại trang danh sách workflow runs, chọn **Run workflow → main → Run workflow**.
3. Mở lần chạy mới, chờ cả `validate` và `deploy` thành công.

Sự kiện `workflow_dispatch` cho deploy dù chưa bật biến tự deploy. **Re-run all jobs** của một lần chạy `push` vẫn dùng sự kiện cũ, không chuyển thành `workflow_dispatch`.

Workflow sẽ kiểm tra code, tải release, ghi `.env`, cài dependencies production, kiểm tra cấu hình, chạy seed, chạy `npm run build`, thay tiến trình `morina-lens`, kiểm tra health rồi cập nhật symlink `current`.

Mỗi lần build tự kiểm tra collection `migrations` trong database `morina-lens`: script đã `completed` thì báo `skipped`, script chưa hoàn tất thì chạy và lưu lịch sử. Xem kết quả trong bước **Build and activate release** của job `deploy`. Migration lỗi sẽ làm build/deploy dừng trước khi dừng tiến trình PM2 cũ. Thêm script mới vào `scripts/migrations/index.js` với ID mới để build sau tự chạy.

### 6.3. Bật deploy khi push

Vào **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Trường | Giá trị |
| --- | --- |
| Name | `MORINA_LENS_DEPLOY_ENABLED` |
| Value | `true` |

Phải là **Repository Variable**, không phải Secret hoặc chỉ là variable trong environment `production`, vì điều kiện job được đánh giá trước khi job chạy.

Khi chưa bật, push vẫn chạy `validate` nhưng `deploy` bị `skipped`. Khi đã bật, push `main` tự deploy. Mỗi repo có cơ chế xếp hàng deploy riêng; không có khóa chung giữa Morina và Lens.

### 6.4. Kiểm tra ứng dụng trên VPS

```bash
pm2 status
pm2 logs morina-lens --lines 50 --nostream
readlink -f /opt/morina-lens/current
curl -fsS http://127.0.0.1:3100/health
```

Kết quả: PM2 `morina-lens` là `online`, `current` trỏ vào release, health trả `{"status":"ok"}`. Chỉ cài Nginx sau khi health nội bộ thành công.

## 7. DNS và Nginx — cấu hình lần đầu

Trong nơi quản lý DNS, tạo:

| Type | Name | Value |
| --- | --- | --- |
| A | `lens` | IP public VPS đang chạy Morina |

Nếu dùng Cloudflare, có thể để **DNS only** cho bản ghi `lens` trong lúc cấp chứng chỉ lần đầu. Kiểm tra bản ghi cũ/AAAA nếu tên miền đi sai server. Giữ nguyên DNS và chính sách của site Morina đang chạy.

**PowerShell Windows:**

```powershell
Resolve-DnsName lens.morina.click -Type A
```

Nếu bật Cloudflare proxy, DNS trả IP Cloudflare là bình thường; kiểm tra IP origin trong dashboard DNS.

**Trên VPS, sau deploy thành công:**

```bash
sudo cp /opt/morina-lens/current/deploy/nginx-morina-lens.conf /etc/nginx/sites-available/morina-lens
sudo ln -s /etc/nginx/sites-available/morina-lens /etc/nginx/sites-enabled/morina-lens
sudo nginx -t
```

Nếu symlink đã tồn tại, bỏ qua lệnh tạo link sau khi kiểm tra nó trỏ đúng file. Chỉ khi `nginx -t` thành công mới chạy:

```bash
sudo systemctl reload nginx
curl -fsS -H 'Host: lens.morina.click' http://127.0.0.1/health
```

File mẫu chỉ nhận `lens.morina.click`, proxy tới `127.0.0.1:3100`. Giữ nguyên site Morina.

**Không copy đè file HTTP mẫu này sau khi Certbot đã thêm HTTPS.** Nginx nằm ngoài release, không cần cài lại sau mỗi push.

## 8. HTTPS và Cloudflare

Trên VPS, kiểm tra Certbot:

```bash
certbot --version
sudo certbot plugins
```

Nếu Ubuntu chưa có Certbot và chưa dùng phương thức cài khác:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

Khi DNS đúng, cổng 80/443 truy cập được, cấp chứng chỉ cho Lens:

```bash
sudo certbot --nginx -d lens.morina.click --redirect
sudo nginx -t
curl -fsS https://lens.morina.click/health
```

Nếu dùng Cloudflare proxy, sau khi VPS có chứng chỉ hợp lệ cho Lens, dùng **Full (strict)** cho kết nối tới origin. Nếu đổi SSL/TLS ở cấp toàn zone `morina.click`, bảo đảm origin Morina hiện tại cũng đáp ứng; ưu tiên giữ chính sách đang hoạt động hoặc cấu hình riêng hostname Lens khi cần. `Flexible` kết nối tới origin bằng HTTP và có thể gây vòng lặp khi origin ép HTTPS. HTTPS ở trình duyệt chưa tự chứng minh VPS có chứng chỉ.

Nếu HTTP trả `301 Moved Permanently` từ Cloudflare, xem địa chỉ chuyển hướng và thử HTTPS:

```bash
curl -I http://lens.morina.click/health
curl -fsSL http://lens.morina.click/health
curl -fsS https://lens.morina.click/health
```

301 là chuyển hướng; `curl -f` không tự đi theo, còn `-L` có. Kết quả cuối cần là JSON health, không chỉ mã 200 hoặc HTML. Kiểm tra trực tiếp HTTPS tại origin ngay trên VPS, bỏ qua Cloudflare nhưng vẫn xác thực chứng chỉ:

```bash
curl -fsS --resolve lens.morina.click:443:127.0.0.1 https://lens.morina.click/health
```

Kiểm tra gia hạn:

```bash
sudo certbot renew --dry-run
systemctl list-timers --all | grep -i certbot
```

Với bản cài apt, xác nhận timer gia hạn đang hoạt động; cách cài khác có thể dùng scheduler khác. Không thêm cron trùng nếu đã có cơ chế gia hạn. Script Certbot/Docker cũ của Morina không phải quy trình gia hạn Nginx host trong hướng dẫn này.

## 9. Đăng nhập và kiểm tra sau deploy

Mở [https://lens.morina.click](https://lens.morina.click), đăng nhập bằng tài khoản đã cấu hình. Cookie production của Lens yêu cầu HTTPS.

- Seed tạo admin nếu chưa tồn tại, mật khẩu được hash. Sửa `ADMIN_PASSWORD` trong secret không tự đổi mật khẩu admin đã tồn tại.
- Kiểm tra cấu hình Shopee, đơn giá lương và quyền staff. Điền đủ cấu hình TikTok trước khi xuất bán.
- Seed/migration có thể bổ sung dữ liệu hoặc chuyển đổi cấu hình theo phiên bản. Sao lưu database trước nâng cấp có thay đổi dữ liệu; seed không phải tác vụ chỉ đọc.
- Thử nghiệp vụ kho/lương trên production sẽ ghi dữ liệu thật; dùng dữ liệu thử có kiểm soát.
- Kiểm tra cả hai app và lưu danh sách PM2:

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3100/health
pm2 status
pm2 save
systemctl status "pm2-$(id -un)" --no-pager
```

Nếu PM2 cùng tài khoản đã tự khởi động từ Morina, `pm2 save` lưu danh sách gồm cả hai tiến trình đang được quản lý. Nếu chưa có service, chạy `pm2 startup`, thực hiện đúng lệnh PM2 in ra, rồi `pm2 save`. Không cần reboot chỉ để kiểm tra khi web đang được sử dụng.

## 10. Deploy những lần sau và giới hạn hiện tại

1. Kiểm tra code local bằng `npm run check` và xem `git status`.
2. Commit các file cần triển khai, push `main` khi sẵn sàng; biến `MORINA_LENS_DEPLOY_ENABLED=true` cần được bật.
3. Theo dõi `validate` và `deploy` trong Actions.
4. Kiểm tra log, health, nghiệp vụ vừa sửa và web còn lại.

Không cần tạo lại database, SSH key, Nginx hoặc chứng chỉ sau mỗi commit. Đổi cấu hình lâu dài trong GitHub Secrets. Đổi `JWT_SECRET` khiến token đăng nhập cũ không còn hợp lệ.

Các giới hạn cần biết:

- Một instance PM2, chế độ `fork`: có gián đoạn lúc thay tiến trình.
- Không tự rollback khi bản mới lỗi. Nếu lỗi sau khi tiến trình cũ bị dừng, app được deploy có thể chưa phục hồi.
- `current` chỉ đổi sau health check thành công. Khi deploy lỗi, `current` có thể vẫn là release cũ trong khi PM2 đã thử chạy release mới. Xem `pm2 describe morina-lens` để xác định code tiến trình thực tế.
- Các release dùng chung `/opt/morina-lens/shared/.env`. Quay lại code cũ không tự phục hồi cấu hình hoặc database cũ.
- Workflow Lens chưa tự dọn release cũ trong `/opt/morina-lens/releases`. Theo dõi dung lượng; trước khi dọn phải xác định release PM2 đang dùng và bản dự phòng cần giữ.

Khi cần khôi phục, xem log, xác định release tốt và tính tương thích với database/cấu hình hiện tại. Có thể triển khai commit sửa lỗi hoặc revert code qua Actions. Khôi phục code không hoàn tác migration; khôi phục database cần kế hoạch riêng và bản sao lưu.

## 11. Xử lý lỗi thường gặp

| Hiện tượng | Kiểm tra và xử lý |
| --- | --- |
| `validate` xanh, `deploy` skipped | Chạy lượt mới bằng **Run workflow**, hoặc thêm **Repository Variable** `MORINA_LENS_DEPLOY_ENABLED=true`. Re-run một sự kiện push vẫn là push. |
| Job chờ phê duyệt | Kiểm tra quy tắc environment `production`; người có quyền phê duyệt nếu được yêu cầu. |
| `Permission denied (publickey)` | Đối chiếu private key trong `VPS_SSH_KEY`, public key trong `authorized_keys` của đúng `VPS_USER`, quyền file SSH; kiểm tra key từ Windows theo mục 4. |
| `mkdir /opt/morina-lens/releases` hoặc `shared`: `Permission denied` | Chạy lệnh `sudo install -d ...` ở mục 2, owner phải đúng `VPS_USER`. Không sửa quyền thư mục Morina. |
| `node`, `npm`, `pm2`: command not found | Kiểm tra PATH trong phiên SSH không tương tác; có lệnh trong terminal tương tác chưa đủ. |
| Thiếu deployment secrets | Kiểm tra đủ bốn tên secret, cả giá trị trùng tên trong environment `production`. |
| URI phải trỏ tới `morina-lens` | Sửa `APP_ENV_FILE` của Lens; path `/morina-lens`, `PORT=3100`. |
| MongoDB authentication failed/timeout | Kiểm tra database user, mật khẩu URL encode, hostname, quyền database và IP VPS trong Atlas Network Access. |
| Cổng 3100 đang được sử dụng | Xác định tiến trình bằng `sudo ss -ltnp 'sport = :3100'`. Chỉ xử lý tiến trình Lens đã xác định; không kill toàn bộ Node/PM2. |
| Health nội bộ lỗi | Xem `pm2 logs morina-lens --lines 100 --nostream` và `pm2 describe morina-lens`. Kiểm tra startup/seed trước khi sửa Nginx. |
| Health 3100 OK nhưng domain lỗi | Kiểm tra Host routing, `server_name`, `proxy_pass`, DNS và HTTPS theo mục 7–8. |
| HTTP trả 301 từ Cloudflare | Xem `Location` bằng `curl -I`, thử HTTPS hoặc `curl -fsSL`. Đây là chuyển hướng, chưa phải lỗi app. |
| Vòng lặp redirect | Kiểm tra Cloudflare Flexible và HTTPS redirect tại origin; dùng Full (strict) sau khi origin có chứng chỉ hợp lệ. |
| Cloudflare 525/526 | Kiểm tra TLS/chứng chỉ tại origin, hostname và hạn chứng chỉ; thử `curl --resolve` ở mục 8. |
| Local health OK nhưng Nginx 502 | Kiểm tra upstream đúng 3100, xem `sudo tail -n 50 /var/log/nginx/error.log`. Không đổi upstream Morina. |
| Đăng nhập không giữ được | Dùng HTTPS, kiểm tra cookie và production env. Nếu đã đổi JWT secret, đăng nhập lại. |
| Đổi `ADMIN_PASSWORD` nhưng tài khoản cũ vẫn dùng mật khẩu cũ | Seed chỉ tạo admin nếu chưa có; đổi mật khẩu bằng chức năng quản trị hiện có. |

Khi gửi log hỗ trợ, che URI có mật khẩu, JWT secret, private key và thông tin cá nhân. Không gửi toàn bộ `.env` hoặc `pm2 jlist` vì có thể chứa biến môi trường nhạy cảm.

## 12. Các lệnh vận hành nhanh

Chạy dưới tài khoản deploy trên VPS:

```bash
pm2 status
pm2 describe morina-lens
pm2 logs morina-lens --lines 100 --nostream
readlink -f /opt/morina-lens/current
curl -fsS http://127.0.0.1:3100/health
curl -fsS https://lens.morina.click/health
free -h
df -h /
```

Khi cần khởi động lại riêng Lens sau khi sửa cấu hình:

```bash
pm2 restart morina-lens --update-env
```

Restart dùng code của tiến trình hiện tại, không tự tải code mới. Triển khai phiên bản mới bằng Actions. Tránh lệnh phạm vi toàn VPS như `pm2 restart all`, `pm2 delete all`, `pm2 kill`, `killall node` khi chỉ cần thao tác một web.

## Tài liệu tham khảo

- [MongoDB Atlas: tạo database user](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/).
- [GitHub: chạy workflow thủ công](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
- [GitHub: biến cấu hình Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables).
- [Cloudflare: Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/) và [vòng lặp chuyển hướng](https://developers.cloudflare.com/ssl/troubleshooting/too-many-redirects/).
- [Certbot: hướng dẫn cài đặt theo hệ điều hành](https://certbot.eff.org/instructions).
