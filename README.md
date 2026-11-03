# MorinaLens

Ứng dụng quản lý shop lens theo kiến trúc Express + Mongoose + EJS MVC của Morina. Có hai vai trò: quản trị và nhân viên. Dữ liệu nằm trong database MongoDB **`morina-lens`**.

## Chức năng

- Quản lý sản phẩm với SKU, tồn kho, giá nhập, `shopeePrice` và `tiktokPrice`. Bật/tắt Ads và đặt tỷ lệ Ads riêng cho từng sàn trên từng sản phẩm; khi bật Ads mà không nhập tỷ lệ riêng, dùng cấu hình của sàn. Admin có thể sửa trực tiếp số lượng tồn trong form sản phẩm; mỗi lần thay đổi sẽ tạo phiếu điều chỉnh kho tự động. Xem giá bán thực, điểm hòa vốn và lợi nhuận dự tính khi sàn đã có đủ cấu hình phí.
- Phiếu nhập, xuất, hoàn hàng nhiều SKU, mỗi phiếu chọn Shopee hoặc TikTok; danh sách có bộ lọc theo sàn. Nhập và hoàn cộng tồn, xuất trừ tồn. Staff tạo phiếu xuất/hoàn ở trạng thái chờ admin duyệt; tồn kho cập nhật ngay. Khi duyệt phiếu xuất, hệ thống cộng đúng 1 đơn cho người tạo và tính lại lương tự động; phiếu hoàn không cộng hoặc trừ đơn. Sửa/xóa phiếu đã duyệt đồng bộ lại công và tồn kho.
- Quản lý tài khoản, số đơn đã đóng theo ngày và lương theo tháng. Mỗi phiếu xuất do staff tạo và được duyệt cộng 1 đơn; lương tạm tính tự tạo theo đơn giá mặc định 1.500 ₫/đơn trong cấu hình hệ thống và cập nhật khi số đơn thay đổi. Admin chốt lương bằng nút **Thanh toán tự động** (trả phần còn lại theo số đơn × đơn giá cấu hình) hoặc **Thanh toán nhập tay** (nhập số tiền trả). Mỗi lần thanh toán được lưu riêng cùng người và thời điểm; tiền đã trả không đổi khi phát sinh đơn mới. Không có chấm công theo giờ.
- Phiếu xuất chọn sàn và dùng giá bán của sản phẩm trên sàn đó. Giá và lợi nhuận được lưu tại thời điểm xuất; phiếu xuất của staff chỉ vào báo cáo sau khi admin duyệt.
- Trang **Doanh thu** chỉ admin xem, tổng hợp doanh thu, chi phí và lợi nhuận dự tính theo tháng, theo sàn và theo ngày. Phiếu hoàn chỉ cộng tồn kho, không đổi báo cáo.
- Cấu hình phí theo sàn và đơn giá mỗi đơn trong hệ thống. Seed 10 cấu hình Shopee cùng đơn giá 1.500 ₫/đơn; TikTok cần điền đủ cấu hình phí trước khi xuất bán và tính lợi nhuận.
- Nhân viên chỉ xem SKU/tên, tồn kho, giá Shopee và giá TikTok trên danh sách sản phẩm. Phiếu kho của nhân viên không hiển thị doanh thu, chi phí, Ads hoặc lợi nhuận; nhân viên chỉ tạo phiếu **xuất** hoặc **hoàn**. Cấu hình giá và báo cáo doanh thu chỉ dành cho quản trị viên.

## Chạy cục bộ

Yêu cầu Node.js 22+ và MongoDB. MongoDB standalone dùng luồng ghi tuần tự với hoàn tác khi có lỗi; MongoDB Atlas/replica set dùng transaction cho phiếu kho nhiều SKU.

```bash
cp .env.example .env
npm ci
npm run migrate:prices
npm start
```

Đặt `MONGODB_URI` với database `morina-lens`, `JWT_SECRET` tối thiểu 32 ký tự, `ADMIN_USERNAME` và `ADMIN_PASSWORD` trong `.env`. App tự seed admin, cấu hình Shopee, đơn giá mỗi đơn và lương còn thiếu của staff khi khởi động. Seed chạy lại không ghi đè đơn giá đã sửa hoặc lương đã nhập thủ công. Mật khẩu cần có giá trị khi tạo tài khoản nhưng không bị giới hạn độ dài; khi sửa, để trống để giữ mật khẩu cũ. Có thể chạy riêng `npm run seed` để kiểm tra. Mặc định app nghe tại `127.0.0.1:3100`.

`npm run migrate:prices` chuyển dữ liệu giá cũ sang `shopeePrice` và `tiktokPrice`. Giá F1 của từng sàn được chọn làm giá bán duy nhất; F2/F3 được giữ trong bản sao JSON tại `backups/`. Script ưu tiên giá `shopeePrice`/`tiktokPrice` đã nhập, chạy lại an toàn, bật Ads Shopee cho sản phẩm cũ để giữ cách tính trước migration và tắt Ads TikTok mặc định. Xem bản sao trước khi chạy trên môi trường khác nếu muốn chọn mức giá khác F1.

## Cách tính giá

Nguồn công thức Shopee: `Tính giá lens/tinh-gia-shopee-ads-15pct.xlsx`. Mỗi sàn dùng giá bán và bộ cấu hình phí riêng. Với một giá bán:

```text
Giá bán thực = giá bán × (1 − voucher shop %) × (1 + thuế %)
Phí sàn = Giá bán thực × (xử lý giao dịch + phí cố định + voucher extra) + phí hạ tầng + Pi ship
Ads = Giá bán thực × Ads %
Thuế phải trả = (Giá bán thực − phí sàn) × thuế %
Rủi ro = Giá bán thực × rủi ro %
Tổng chi phí tại giá này = giá nhập + phí sàn + Ads + thuế phải trả + đóng gói + rủi ro
Lợi nhuận = Giá bán thực − tổng chi phí tại giá này
```

File Excel gọi **tổng chi phí tại giá bán đang nhập** là “Điểm hòa vốn”; giao diện hiển thị chỉ số này cho mỗi sàn. Vì phí sàn, Ads, thuế và rủi ro phụ thuộc vào giá bán, tổng chi phí thay đổi theo giá bán. Một chỉ số khác là **giá cần bán để lợi nhuận bằng 0**; ứng dụng chỉ hiển thị mức giá này trong phần “Xem cách tính” để không nhầm với “Điểm hòa vốn” theo Excel. File Excel không dùng cột voucher shop trong công thức; ứng dụng áp voucher shop như tỷ lệ giảm vào giá bán trước khi cộng thuế. Giá mặc định voucher shop = 0 nên kết quả không đổi. Cấu hình mặc định dùng đóng gói 2.500 ₫ và chi phí rủi ro 1,5%; ô ví dụ trong Excel dùng đóng gói 2.000 ₫.

Phiếu xuất tự lấy Ads từ sản phẩm trên sàn đã chọn. Sản phẩm bật Ads sẽ dùng tỷ lệ riêng nếu có, nếu để trống dùng cấu hình sàn; nhập tỷ lệ riêng `0` nghĩa là Ads 0%. Sản phẩm tắt Ads luôn tính 0%. Tỷ lệ đã dùng được lưu trong từng dòng phiếu xuất.

## Báo cáo doanh thu

Mỗi dòng phiếu **xuất** dùng giá bán và Ads của sản phẩm trên sàn đã chọn. Hệ thống lưu ảnh chụp giá bán thực, tổng chi phí và lợi nhuận trên từng đơn vị tại lúc tạo phiếu. Báo cáo tháng chỉ cộng phiếu xuất **đã duyệt** theo ngày phiếu; phiếu chờ duyệt, phiếu hoàn và phiếu điều chỉnh tồn từ trang sản phẩm không ảnh hưởng báo cáo. Nếu sửa số lượng trên phiếu, ảnh chụp đơn giá được giữ; đổi SKU hoặc sàn sẽ tính lại. Các phiếu cũ không có ảnh chụp giá được báo riêng và không bị gán doanh thu giả. Đây là số liệu **dự tính theo giá bán**, chưa phải tiền thực nhận từ sàn.

## Lưu ý kho

Tồn đầu kỳ nhập khi tạo sản phẩm. Sau đó có thể thay đổi bằng phiếu kho hoặc sửa trực tiếp trong form sản phẩm; cách sửa trực tiếp sẽ ghi một phiếu nhập/xuất điều chỉnh tự động. Nếu tồn kho thay đổi trong lúc admin đang mở form, hệ thống yêu cầu tải lại để tránh ghi đè thao tác mới. Không thể xóa sản phẩm đã có lịch sử kho. Trên MongoDB standalone, app ghi tuần tự và cố gắng hoàn tác khi có lỗi; để đảm bảo tính nguyên tử giữa nhiều bản ghi trong production, dùng MongoDB Atlas hoặc replica set.

Deploy lên VPS Morina qua GitHub Actions: [DEPLOY_VPS.md](DEPLOY_VPS.md). Production dùng `lens.morina.click` và database `morina-lens` mới, không sao chép dữ liệu local.
