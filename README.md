# MorinaLens

Ứng dụng quản lý shop lens theo kiến trúc Express + Mongoose + EJS MVC của Morina. Có hai vai trò: quản trị và nhân viên. Dữ liệu nằm trong database MongoDB **`morina-lens`**.

## Chức năng

- Quản lý sản phẩm với SKU, tồn kho, giá nhập, `shopeePrice` và `tiktokPrice`. Bật/tắt Ads và đặt tỷ lệ Ads riêng cho từng sàn trên từng sản phẩm; khi bật Ads mà không nhập tỷ lệ riêng, dùng cấu hình của sàn. Admin có thể sửa trực tiếp số lượng tồn trong form sản phẩm; mỗi lần thay đổi sẽ tạo phiếu điều chỉnh kho tự động. Xem giá bán thực, điểm hòa vốn và lợi nhuận dự tính khi sàn đã có đủ cấu hình phí.
- Phiếu nhập, xuất, hoàn hàng nhiều SKU, mỗi phiếu chọn Shopee hoặc TikTok; danh sách có bộ lọc theo sàn. Nhập và hoàn cộng tồn, xuất trừ tồn. Staff tạo phiếu xuất/hoàn ở trạng thái chờ admin duyệt; tồn kho cập nhật ngay. Khi duyệt phiếu xuất, hệ thống cộng đúng 1 đơn cho người tạo và tính lại lương tự động; phiếu hoàn không cộng hoặc trừ đơn. Sửa/xóa phiếu đã duyệt đồng bộ lại công và tồn kho.
- Quản lý tài khoản, số đơn đã đóng theo ngày và lương theo tháng. Mỗi phiếu xuất do staff tạo và được duyệt cộng 1 đơn; lương tạm tính tự tạo theo đơn giá mặc định 1.500 ₫/đơn trong cấu hình hệ thống và cập nhật khi số đơn thay đổi. Admin chốt lương bằng nút **Thanh toán tự động** (trả phần còn lại theo số đơn × đơn giá cấu hình) hoặc **Thanh toán nhập tay** (nhập số tiền trả). Mỗi lần thanh toán được lưu riêng cùng người và thời điểm; tiền đã trả không đổi khi phát sinh đơn mới. Không có chấm công theo giờ.
- Phiếu xuất chọn sàn và dùng giá bán của sản phẩm trên sàn đó. Giá và lợi nhuận được lưu tại thời điểm xuất; phiếu xuất của staff chỉ vào báo cáo sau khi admin duyệt.
- Trang **Doanh thu** chỉ admin xem, tổng hợp doanh thu, chi phí và lợi nhuận dự tính theo tháng, theo sàn và theo ngày. Phiếu hoàn chỉ cộng tồn kho, không đổi báo cáo.
- Cấu hình phí theo sàn và đơn giá mỗi đơn trong hệ thống. Seed 10 cấu hình Shopee cùng đơn giá 1.500 ₫/đơn; TikTok cần điền đủ cấu hình phí trước khi xuất bán và tính lợi nhuận.
- Trang **Hướng dẫn** (`/guide`, chỉ quản trị viên) giải thích từng khoản phí, hiển thị cấu hình đang dùng của Shopee/TikTok, hướng dẫn nhập voucher bằng tiền và minh họa đơn Shopee có thực nhận 47.031đ cùng cách tính Ads, lợi nhuận.
- Nhân viên chỉ xem SKU/tên, tồn kho, giá Shopee và giá TikTok trên danh sách sản phẩm. Phiếu kho của nhân viên không hiển thị doanh thu, chi phí, Ads hoặc lợi nhuận; nhân viên chỉ tạo phiếu **xuất** hoặc **hoàn**. Cấu hình giá và báo cáo doanh thu chỉ dành cho quản trị viên.

## Chạy cục bộ

Yêu cầu Node.js 22+ và MongoDB. MongoDB standalone dùng luồng ghi tuần tự với hoàn tác khi có lỗi; MongoDB Atlas/replica set dùng transaction cho phiếu kho nhiều SKU.

```bash
cp .env.example .env
npm ci
npm start
```

Đặt `MONGODB_URI` với database `morina-lens`, `JWT_SECRET` tối thiểu 32 ký tự, `ADMIN_USERNAME` và `ADMIN_PASSWORD` trong `.env`. App tự seed admin, cấu hình Shopee, đơn giá mỗi đơn và lương còn thiếu của staff khi khởi động. Seed chạy lại không ghi đè đơn giá đã sửa hoặc lương đã nhập thủ công. Mật khẩu cần có giá trị khi tạo tài khoản nhưng không bị giới hạn độ dài; khi sửa, để trống để giữ mật khẩu cũ. Có thể chạy riêng `npm run seed` để kiểm tra. Mặc định app nghe tại `127.0.0.1:3100`.

## Cách tính giá

Mỗi sàn dùng giá bán và bộ cấu hình phí riêng. Giá bán nhập vào đã bao gồm thuế; ứng dụng không cộng thuế vào doanh thu. Công thức phiên bản 2 đối chiếu theo chi tiết doanh thu Shopee của shop:

```text
Voucher shop (trợ giá) = min(giá bán, số tiền voucher shop cấu hình)
Giá bán thực (doanh thu) = giá bán − voucher shop
Phí sàn = round(doanh thu × xử lý giao dịch %) + round(doanh thu × phí cố định %)
        + round(doanh thu × voucher extra %) + phí hạ tầng + Pi ship
Thuế phải trả = doanh thu × thuế % (trước khi trừ phí sàn)
Thực nhận ước tính = doanh thu − phí sàn − thuế phải trả
Ads = max(0, thực nhận ước tính) × Ads %
Rủi ro = Giá bán thực × rủi ro %
Tổng chi phí tại giá này = giá nhập + phí sàn + Ads + thuế phải trả + đóng gói + rủi ro
Lợi nhuận = Giá bán thực − tổng chi phí tại giá này
```

Mức thuế 1,5% được làm tròn riêng GTGT 1% và TNCN 0,5%; mức thuế cấu hình khác được làm tròn một lần. Ví dụ giá 72.966đ, voucher shop 2.000đ: doanh thu 70.966đ, phí cố định 11.709đ (16,5%), Voucher Xtra 3.903đ (5,5%), hạ tầng 3.000đ, xử lý giao dịch 4.258đ (6%), thuế 1.065đ, thực nhận 47.031đ; Ads 15% là 7.054,65đ.

File Excel gọi **tổng chi phí tại giá bán đang nhập** là “Điểm hòa vốn”; giao diện giữ chỉ số này. **Giá cần bán để lợi nhuận bằng 0** trong phần “Xem cách tính” là ước tính liên tục theo công thức mới; việc làm tròn từng khoản phí có thể làm lợi nhuận tại mức giá này lệch vài đồng. Mặc định: phí cố định 16,5%, voucher shop 0đ, đóng gói 2.500đ và rủi ro 1,5%. Voucher shop là tiền giảm của shop, tách biệt với phí Voucher Xtra 5,5%.

Phép ước tính hiện tính theo một sản phẩm: các khoản tiền cố định (voucher shop, hạ tầng, Pi ship, đóng gói) áp dụng trên mỗi đơn vị. Nếu một đơn có nhiều sản phẩm, cần phân bổ voucher cả đơn thành số tiền cho một sản phẩm; ứng dụng chưa phân bổ phí theo đơn thực tế. Ship được Shopee bù toàn bộ trong đơn mẫu nên không trừ thêm 16.500đ. Phí giao dịch trong phép ước tính chưa cộng ship người mua trả hoặc trừ ưu đãi ngân hàng.

Khi khởi động/seed, migration chuyển phí cố định Shopee hiện có sang 16,5% một lần và đặt voucher shop có đơn vị `%` về 0đ (cả Shopee và TikTok). Sau chuyển đổi, các chỉnh sửa tiếp theo của admin được giữ khi khởi động lại. Migration không sửa snapshot lịch sử.

Phiếu xuất tự lấy Ads từ sản phẩm trên sàn đã chọn. Sản phẩm bật Ads sẽ dùng tỷ lệ riêng nếu có, nếu để trống dùng cấu hình sàn; nhập tỷ lệ riêng `0` nghĩa là Ads 0%. Sản phẩm tắt Ads luôn tính 0%. Tỷ lệ đã dùng được lưu trong từng dòng phiếu xuất.

## Báo cáo doanh thu

Mỗi dòng phiếu **xuất** lưu `items[].saleSnapshot` gồm phiên bản công thức (`pricingVersion`), giá bán (`listPrice`), giá nhập (`purchasePrice`), tỷ lệ Ads (`adsPercentApplied`), tiền Ads (`unitAdsCost`), giá bán thực, tổng chi phí và lợi nhuận trên từng đơn vị. Toàn bộ 10 cấu hình phí nằm chung trong `saleSnapshot.config`. Tính lại bằng `pricing.calculate(listPrice, purchasePrice, config, adsPercentApplied, pricingVersion ?? 1)`; phiên bản 1 vẫn diễn giải voucher theo phần trăm và dùng công thức thuế/Ads cũ. Phiếu mới dùng phiên bản 2. Báo cáo dùng tiền Ads đã lưu; phiếu cũ thiếu trường này giữ cách tính Ads lịch sử.

Báo cáo tháng chỉ cộng phiếu xuất **đã duyệt** theo ngày phiếu; phiếu chờ duyệt, phiếu hoàn và điều chỉnh tồn không ảnh hưởng báo cáo. Sửa số lượng giữ snapshot; thêm SKU hoặc đổi sàn lấy giá/cấu hình mới. Phiếu cũ giữ nguyên kết quả lịch sử; dòng thiếu snapshot được báo riêng. Đây là số liệu **dự tính theo giá bán**, chưa phải đối soát tiền thực nhận từ sàn.

## Lưu ý kho

Script `node scripts/recalculate-local-sales.js` chỉ sửa lỗi giá chưa gồm thuế của phiên bản 1 trên **local** (mặc định xem trước, `--apply` để ghi); bỏ qua snapshot phiên bản 2 và không chuyển công thức thuế/Ads/voucher lịch sử. Script chỉ kết nối MongoDB local/database `morina-lens`, sao lưu phiếu gốc vào `backups/` trước khi ghi và không đổi tồn kho, công hoặc thời điểm tạo phiếu. Phiếu thiếu đầu vào lịch sử chỉ được cập nhật nếu tái hiện khớp toàn bộ kết quả cũ. Chạy lại không thay đổi snapshot đã cập nhật.

Tồn đầu kỳ nhập khi tạo sản phẩm. Sau đó có thể thay đổi bằng phiếu kho hoặc sửa trực tiếp trong form sản phẩm; cách sửa trực tiếp sẽ ghi một phiếu nhập/xuất điều chỉnh tự động. Nếu tồn kho thay đổi trong lúc admin đang mở form, hệ thống yêu cầu tải lại để tránh ghi đè thao tác mới. Không thể xóa sản phẩm đã có lịch sử kho. Trên MongoDB standalone, app ghi tuần tự và cố gắng hoàn tác khi có lỗi; để đảm bảo tính nguyên tử giữa nhiều bản ghi trong production, dùng MongoDB Atlas hoặc replica set.

Deploy lên VPS Morina qua GitHub Actions: [DEPLOY_VPS.md](DEPLOY_VPS.md). Production dùng `lens.morina.click` và database `morina-lens` mới, không sao chép dữ liệu local.
