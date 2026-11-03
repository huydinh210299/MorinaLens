# Deploy MorinaLens qua GitHub Actions lên VPS của Morina

Repository: `https://github.com/huydinh210299/MorinaLens` · nhánh `main` · tên miền `lens.morina.click`.

Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) làm theo quy trình của Morina: kiểm tra mã, đóng gói release, tải lên VPS qua SSH, chạy seed, khởi động PM2 rồi kiểm tra `/health`. MorinaLens dùng riêng `/opt/morina-lens`, cổng nội bộ `3100`, PM2 `morina-lens` và database `morina-lens`. Database production **bắt đầu trống**; workflow không sao chép dữ liệu local.

Hai web chạy song song trên cùng VPS. Workflow MorinaLens không ghi vào `/opt/rental-shop`, không quản lý tiến trình PM2 `rental-shop` hoặc cổng `3000`. Site Nginx của MorinaLens chỉ nhận `lens.morina.click`; giữ nguyên site Nginx đang phục vụ Morina. Kiểm tra tài nguyên VPS trước khi chạy thêm ứng dụng.

## 1. Chuẩn bị database production

Tạo database `morina-lens` trên MongoDB Atlas, có thể dùng cùng cluster với Morina nhưng nên dùng database user riêng. Cho phép IP của VPS trong Atlas Network Access. URI phải có `/morina-lens` trong đường dẫn:

```text
mongodb+srv://LENS_USER:ENCODED_PASSWORD@CLUSTER.mongodb.net/morina-lens?retryWrites=true&w=majority
```

Không đưa URI thật vào Git. Seed sẽ tạo admin, 10 cấu hình Shopee và đơn giá lương 1.500 ₫/đơn. TikTok chưa có phí mặc định.

## 2. Chuẩn bị VPS một lần

Dùng cùng tài khoản deploy và khóa SSH như workflow Morina. Trên VPS:

```bash
ssh deploy@VPS_IP
node --version               # cần 22 trở lên
pm2 --version
sudo install -d -o deploy -g deploy -m 755 /opt/morina-lens
```

Tài khoản `deploy` phải đăng nhập được bằng khóa SSH mà GitHub Actions sẽ dùng. Ứng dụng chỉ nghe tại `127.0.0.1:3100`; không mở cổng 3100 ra Internet. Giữ nguyên dịch vụ Morina hiện tại.

## 3. Cấu hình GitHub repository

Trong repository MorinaLens, vào **Settings → Secrets and variables → Actions**. Tạo bốn repository secrets riêng cho repository này:

| Secret | Giá trị |
| --- | --- |
| `VPS_HOST` | IP hoặc hostname VPS đang chạy Morina |
| `VPS_USER` | `deploy` hoặc tài khoản đang dùng để deploy Morina |
| `VPS_SSH_KEY` | Private key có public key trong `~deploy/.ssh/authorized_keys` trên VPS |
| `APP_ENV_FILE` | Toàn bộ nội dung `.env` production của MorinaLens bên dưới |

Nội dung mẫu cho `APP_ENV_FILE` (thay toàn bộ giá trị mẫu):

```dotenv
PORT=3100
NODE_ENV=production
MONGODB_URI=mongodb+srv://LENS_USER:ENCODED_PASSWORD@CLUSTER.mongodb.net/morina-lens?retryWrites=true&w=majority
JWT_SECRET=RANDOM_SECRET_AT_LEAST_32_CHARACTERS
COOKIE_NAME=morina_lens_token
ADMIN_USERNAME=admin
ADMIN_PASSWORD=NEW_ADMIN_PASSWORD
```

Tạo `JWT_SECRET` bằng `openssl rand -hex 32`. Dùng mật khẩu admin riêng cho MorinaLens. GitHub Actions ghi `.env` vào `/opt/morina-lens/shared/.env` trên VPS với quyền `600`; file này không nằm trong repository.

Workflow có thể chạy thủ công bằng **Actions → Deploy MorinaLens to VPS → Run workflow** sau khi thêm secrets. Để các lần push `main` tiếp theo tự deploy như Morina, tạo repository variable `MORINA_LENS_DEPLOY_ENABLED` với giá trị `true`. Khi chưa có variable này, push vẫn chạy kiểm tra mã nhưng bỏ qua deploy.

## 4. DNS, Nginx và HTTPS

Tạo bản ghi DNS `A` cho `lens.morina.click` trỏ đến cùng IP VPS của Morina. Sau khi lần deploy đầu tiên chạy thành công và `/opt/morina-lens/current` đã tồn tại, cài site Nginx riêng:

```bash
sudo cp /opt/morina-lens/current/deploy/nginx-morina-lens.conf /etc/nginx/sites-available/morina-lens
sudo ln -s /etc/nginx/sites-available/morina-lens /etc/nginx/sites-enabled/morina-lens
sudo nginx -t
sudo systemctl reload nginx
curl -f http://lens.morina.click/health
sudo certbot --nginx -d lens.morina.click
curl -f https://lens.morina.click/health
```

Nginx site này chỉ xử lý `lens.morina.click` và chuyển tiếp đến cổng 3100. Không thay file Nginx của Morina. Nếu symlink đã tồn tại, không tạo lại. Certbot cần DNS trỏ đúng VPS và cổng 80/443 đang hoạt động.

## 5. Kiểm tra sau deploy

```bash
pm2 status
pm2 logs morina-lens --lines 50
readlink -f /opt/morina-lens/current
curl -f http://127.0.0.1:3100/health
```

Đăng nhập admin mới, kiểm tra cấu hình Shopee, đơn giá lương 1.500 ₫ và quyền staff. Tạo sản phẩm, thử phiếu xuất của staff: chỉ khi admin duyệt mới cộng 1 đơn tính công. Lương mới là tạm tính; admin ghi nhận thanh toán tự động hoặc nhập tay trên trang nhân viên. Phiếu hoàn chỉ tăng tồn kho, không đổi báo cáo doanh thu.

Mỗi lần push `main` sau khi bật variable deploy sẽ tạo release mới. Workflow chạy `npm run seed` an toàn khi lặp lại; không ghi đè cấu hình đã chỉnh. Release cũ còn trong `/opt/morina-lens/releases/` để có thể kiểm tra hoặc khôi phục thủ công.
