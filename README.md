# AI Hospital Forecasting System

Hệ thống dự báo số lượng bệnh nhân khám ngoại trú sử dụng XGBoost Regressor kết hợp Dashboard trực quan trên nền tảng Flask.
## ⚠️ Lưu ý

Đây là **mô hình dự báo**, vì vậy kết quả chỉ mang tính hỗ trợ ra quyết định và **không đảm bảo chính xác tuyệt đối**.

Trong quá trình thử nghiệm, mô hình đạt độ chính xác khoảng **82–83%** (đánh giá theo WAPE), tuy nhiên sai số vẫn có thể xuất hiện do nhiều yếu tố như:

* Biến động bất thường của số lượng bệnh nhân.
* Các sự kiện đặc biệt ngoài dữ liệu huấn luyện.
* Thay đổi chính sách hoặc quy trình khám chữa bệnh.

Do đó, kết quả dự báo nên được sử dụng như một công cụ hỗ trợ cho công tác lập kế hoạch và điều phối, không nên xem là giá trị tuyệt đối. Mô hình được xây dựng nhằm hỗ trợ công tác lập kế hoạch và điều phối nguồn lực, không thay thế quyết định chuyên môn của nhân viên y tế.

---

## 📈 Data Drift (Độ trôi dữ liệu)

Theo thời gian, dữ liệu thực tế của bệnh viện sẽ thay đổi (Data Drift).

Nếu tiếp tục sử dụng một mô hình đã được huấn luyện từ rất lâu mà không cập nhật dữ liệu mới, sai số dự báo có thể tăng lên đáng kể.

Để duy trì hiệu quả dự báo, nên:

* Cập nhật dữ liệu định kỳ.
* Huấn luyện lại mô hình sau khi có thêm dữ liệu mới.
* Đánh giá MAE và WAPE trước khi kích hoạt mô hình mới.
* Luôn ưu tiên sử dụng phiên bản mô hình được huấn luyện từ dữ liệu mới nhất.

---

## Giới thiệu

AI Hospital Forecasting System là hệ thống dự báo số lượng bệnh nhân khám ngoại trú sử dụng thuật toán **XGBoost Regressor** kết hợp Dashboard trực quan trên nền tảng Flask.

Hệ thống hỗ trợ:

* Dự báo số lượng bệnh nhân theo ngày.
* Theo dõi dữ liệu lịch sử và dữ liệu dự báo.
* Hiển thị Dashboard trực quan.
* Quản lý nhiều phiên bản mô hình (Model Registry).
* Huấn luyện lại mô hình trực tiếp trên giao diện Web.
* Hỗ trợ ra quyết định thông qua các cảnh báo vận hành.

---

## Công nghệ sử dụng

* Python
* Flask
* XGBoost
* Pandas
* NumPy
* ApexCharts
* HTML/CSS/JavaScript
* OpenPyXL
* Holidays (Vietnam)

---

## Chức năng chính

* Dự báo lượt khám bệnh theo ngày.
* Dashboard trực quan.
* Heatmap mức độ quá tải.
* Stress Gauge.
* Decision Support System (DSS).
* Retrain Model trực tiếp từ giao diện.
* Adaptive Hyperparameters.
* Model Registry.
* Activate / Delete Model.
* Export dữ liệu dự báo.

---



## Khuyến nghị

- Nên huấn luyện lại mô hình định kỳ (ví dụ mỗi tháng hoặc sau khi có đủ dữ liệu mới).
- Chỉ kích hoạt mô hình mới sau khi đánh giá các chỉ số MAE và WAPE.
- Ưu tiên sử dụng phiên bản mô hình được huấn luyện từ dữ liệu mới nhất.
- Thường xuyên sao lưu thư mục `model/`.

---

## Disclaimer

This project was developed during my internship as a research and development project.

The forecasting results are intended to assist hospital staff in planning and decision-making. Since the model is based on historical data, prediction errors may occur and the results should not be considered absolute values.

To maintain forecasting performance, the model should be periodically retrained using the latest hospital data, as changes in patient arrival patterns over time (data drift) may reduce prediction accuracy.

⭐ This project was developed for educational, research, and internship purposes. Feel free to use it as a reference for learning and further development.
