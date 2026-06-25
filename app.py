from flask import Flask, request, Response, render_template, jsonify
import pickle
import os
import pandas as pd
import numpy as np
import datetime
import json  
import holidays  

# Khởi tạo Flask
app = Flask(__name__)



# Khởi tạo bộ ngày lễ Việt Nam cho các năm liên quan
vn_holidays = holidays.VN(years=[2024, 2025, 2026, 2027, 2028, 2029, 2030])

# Hàm kiểm tra tự động xem ngày đó có phải nghỉ lễ không
def check_is_holiday(dt):
    # CHUẨN HÓA: Ép kiểu dữ liệu về date nguyên bản để đối chiếu chính xác với thư viện holidays
    if hasattr(dt, 'date'):
        dt = dt.date()
    elif isinstance(dt, str):
        try:
            dt = pd.to_datetime(dt).date()
        except:
            pass
    return 1 if dt in vn_holidays else 0

# Khai báo Danh sách đặc trưng đầy đủ dùng cho việc HUẤN LUYỆN LẠI mô hình mới
FEATURES_WITH_HOLIDAY = [
    'dayofweek', 'month', 'day', 'is_weekend', 'is_holiday',
    'lag_1', 'lag_7', 'lag_30', 'rolling_mean_7'
]

# Hàm phân tích định dạng ngày linh hoạt toàn cục (Global Scope)
def parse_date(d):
    if isinstance(d, (datetime.datetime, datetime.date, pd.Timestamp)):
        return pd.to_datetime(d)
        
    d = str(d).strip()
    
    if ' ' in d:
        d = d.split(' ')[0]
        
    for fmt in ('%d/%m/%y', '%d/%m/%Y', '%Y-%m-%d', '%m/%d/%Y'):
        try:
            return datetime.datetime.strptime(d, fmt)
        except:
            pass
    return pd.NaT

# Hàm tính toán WAPE (Weighted Absolute Percentage Error) - Tiêu chuẩn vàng trong dự báo y tế & vận hành
def calculate_wape(y_true, y_pred):
    y_true = np.array(y_true)
    y_pred = np.array(y_pred)
    total_actual = np.sum(np.abs(y_true))
    if total_actual == 0:
        return 0.0
    return np.sum(np.abs(y_true - y_pred)) / total_actual

# ─── Load Model Bundle (NÂNG CẤP: Tải động mô hình đang Active) ──────────────
bundle_folder = os.path.join(app.root_path, "model")
active_config_path = os.path.join(bundle_folder, "active_model.json")
hist_path   = os.path.join(app.root_path, "model", "historical_data.csv")

# Mặc định sử dụng file gốc nếu chưa có cấu hình kích hoạt cụ thể
active_model_file = "hospital_xgb_bundle.pkl"
if os.path.exists(active_config_path):
    try:
        with open(active_config_path, "r") as f:
            config = json.load(f)
            active_model_file = config.get("active_model", "hospital_xgb_bundle.pkl")
    except:
        pass

bundle_path = os.path.join(bundle_folder, active_model_file)

# Helper hàm lấy tên file active phục vụ kiểm tra
def get_active_model_filename():
    if os.path.exists(active_config_path):
        try:
            with open(active_config_path, "r") as f:
                config = json.load(f)
                return config.get("active_model", "hospital_xgb_bundle.pkl")
        except:
            pass
    return "hospital_xgb_bundle.pkl"

try:
    with open(bundle_path, "rb") as f:
        bundle = pickle.load(f)
    model_xgb      = bundle['model']
    features_xgb   = bundle['features']
    mae_xgb        = float(bundle['mae'])
    mape_xgb       = float(bundle['mape'])
    train_date_xgb = bundle.get('train_date', datetime.datetime(2026, 6, 1))
    version_xgb    = bundle.get('version', 'v1')
    model_name_xgb = bundle.get('model_name', 'Hospital_XGBoost')
    print(f"Loaded Active Model Bundle: {active_model_file} successfully!")
    print(f"Features: {features_xgb}")
    print(f"MAE: {mae_xgb} | MAPE: {round(mape_xgb*100,2)} %")
except Exception as e:
    print(f"Lỗi load Bundle: {e}")
    model_xgb = None
    features_xgb = ['dayofweek', 'month', 'day', 'is_weekend', 'lag_1', 'lag_7', 'lag_30', 'rolling_mean_7']
    mae_xgb, mape_xgb = 574.5, 0.1905

# ─── Load Historical Data ────────────────────────────────────────────────────
try:
    df_hist = pd.read_csv(hist_path)
    df_hist.columns = [c.strip().lower() for c in df_hist.columns]
    df_hist = df_hist.dropna(subset=['date', 'actual'])
    df_hist = df_hist[df_hist['date'].astype(str).str.strip() != '']
    
    df_hist['date'] = df_hist['date'].apply(parse_date)
    df_hist = df_hist.dropna(subset=['date'])
    df_hist['actual'] = pd.to_numeric(df_hist['actual'], errors='coerce')
    df_hist = df_hist.dropna(subset=['actual'])
    df_hist = df_hist.sort_values('date').set_index('date')
    print(f"Loaded Historical Data successfully! Rows: {len(df_hist)}")
    print(f"Date range: {df_hist.index.min().date()} to {df_hist.index.max().date()}")
except Exception as e:
    print(f"Lỗi load Historical Data: {e}")
    df_hist = None

# ─── Forecast Cache (tránh recompute nhiều lần) ───────────────────────────
_forecast_cache = {}

# ─── Forecast Cache (Cơ chế sinh dự báo quá khứ & tương lai an toàn tuyệt đối) ───
def get_forecast_up_to(end_date, start_date=None):
    if model_xgb is None or df_hist is None:
        return {}
    
    last_actual_date = df_hist.index.max()
    
    # 1. TỰ ĐỘNG CÂN BẰNG MỐC BẮT ĐẦU (Tránh đứt gãy chuỗi Lag Features)
    if start_date is None:
        if end_date <= last_actual_date:
            start_predict = end_date.replace(day=1)
        else:
            start_predict = last_actual_date + pd.Timedelta(days=1)
    else:
        if end_date > last_actual_date:
            start_predict = min(start_date, last_actual_date + pd.Timedelta(days=1))
        else:
            start_predict = start_date

    end_key = f"{start_predict.date()}_{end_date.date()}"
    if end_key in _forecast_cache:
        return _forecast_cache[end_key]

    pred_dates = pd.date_range(start=start_predict, end=end_date)
    results = {}

    # SỬA LỖI CASCADE 0: Xác định cận dưới an toàn dựa trên số ca khám thấp nhất lịch sử (giữ nguyên sụt tải ngày Tết)
    hist_min = float(df_hist['actual'].min()) if df_hist is not None else 300.0

    for current_date in pred_dates:
        # Lấy giá trị trễ thực tế nếu có trong CSV, ngược lại lấy giá trị đã dự đoán trước đó
        def get_val(d):
            if df_hist is not None and d in df_hist.index:
                return float(df_hist.loc[d, 'actual'])
            return results.get(d, 4500.0)

        lag_1 = get_val(current_date - pd.Timedelta(days=1))
        lag_7 = get_val(current_date - pd.Timedelta(days=7))
        lag_30= get_val(current_date - pd.Timedelta(days=30))
        roll7 = float(np.mean([get_val(current_date - pd.Timedelta(days=i)) for i in range(1, 8)]))

        feat_df = pd.DataFrame([{
            'dayofweek':    current_date.dayofweek,
            'month':        current_date.month,
            'day':          current_date.day,
            'is_weekend':   1 if current_date.dayofweek >= 5 else 0,
            'is_holiday':   check_is_holiday(current_date),
            'lag_1':        lag_1,
            'lag_7':        lag_7,
            'lag_30':       lag_30,
            'rolling_mean_7': roll7
        }])[features_xgb]

        pred = float(model_xgb.predict(feat_df)[0])
        # Sử dụng mức thấp nhất từng ghi nhận làm cận dưới an toàn (không lo bị sập về 0)
        results[current_date] = max(hist_min, pred)

    _forecast_cache[end_key] = results
    return results

# Ánh xạ đầy đủ từ Tháng 5 đến Tháng 12 năm 2026
month_map_global = {
    "May": "2026-05-01", "June": "2026-06-01", "July": "2026-07-01",
    "Aug": "2026-08-01", "Sept": "2026-09-01", "Oct": "2026-10-01",
    "Nov": "2026-11-01", "Dec": "2026-12-01"
}

# HÀM SIÊU TỐI ƯU HÓA BỐI CẢNH CHO AI
def get_forecast_summary_text(start_month_str, horizon_days):
    start_date = pd.to_datetime(month_map_global.get(start_month_str, "2026-06-01"))
    
    month_vn_map = {
        "May": "Tháng 5", "June": "Tháng 6", "July": "Tháng 7",
        "Aug": "Tháng 8", "Sept": "Tháng 9", "Oct": "Tháng 10",
        "Nov": "Tháng 11", "Dec": "Tháng 12"
    }
    start_month_vn = month_vn_map.get(start_month_str, start_month_str)
    
    if start_date.month == 12:
        end_of_month = pd.to_datetime(f"{start_date.year}-12-31")
    else:
        end_of_month = pd.to_datetime(f"{start_date.year}-{start_date.month+1:02d}-01") - pd.Timedelta(days=1)
        
    forecasts = get_forecast_up_to(end_of_month)
    month_days = {d: v for d, v in forecasts.items() if start_date <= d <= end_of_month}
    
    if not month_days:
        return f"Không có dữ liệu dự báo cho {start_month_vn}.", 4500
        
    vals = list(month_days.values())
    avg_val = int(np.mean(vals))
    
    day_names_short = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]
    sorted_days = sorted(month_days.items(), key=lambda x: x[1], reverse=True)
    
    top_busy = [f"{day_names_short[d.weekday()]} ngày {d.strftime('%d/%m')}: {int(v)} ca" for d, v in sorted_days[:3]]
    top_low = [f"{day_names_short[d.weekday()]} ngày {d.strftime('%d/%m')}: {int(v)} ca" for d, v in sorted_days[-3:]]
    
    overload_days = [f"{day_names_short[d.weekday()]} {d.strftime('%d/%m')}: {int(v)} ca" 
                     for d, v in sorted(month_days.items()) if v > 5000]
    overload_str = ", ".join(overload_days) if overload_days else "Không có ngày nào bị quá tải."
    
    context = (
        f"{start_month_vn}/2026:\n"
        f"- Lượt khám trung bình: {avg_val} ca/ngày.\n"
        f"- 3 NGÀY ĐÔNG NHẤT THÁNG: {', '.join(top_busy)}.\n"
        f"- 3 NGÀY VẮNG NHẤT THÁNG: {', '.join(top_low)}.\n"
        f"- Các ngày quá tải (>5000 ca): {overload_str}."
    )
    return context, avg_val

# ─── Routes ──────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/forecast', methods=['GET'])
def get_forecast():
    month_param = request.args.get('month', 'auto')
    horizon     = int(request.args.get('horizon', 30))

    last_actual_date = df_hist.index.max() if df_hist is not None else pd.to_datetime("2025-12-31")

    if month_param == 'auto':
        start_date = last_actual_date + pd.Timedelta(days=1)
        start_date = start_date.replace(day=1)
    else:
        try:
            start_date = pd.to_datetime(month_param)
        except:
            start_date = pd.to_datetime("2026-06-01")

    end_date = start_date + pd.Timedelta(days=horizon - 1)
    
    # Định nghĩa overlap_start tại đây để truyền vào hàm dự báo bên dưới
    overlap_start = pd.to_datetime("2025-12-01")

    # TỰ ĐỘNG TÍNH TOÁN 12 THÁNG KHẢ DỤNG THEO NĂM HOẠT ĐỘNG
    active_year = (last_actual_date + pd.Timedelta(days=1)).year
    available_months = []
    month_names_vn = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"]
    for m in range(1, 13):
        m_date = pd.to_datetime(f"{active_year}-{m:02d}-01")
        available_months.append({
            "value": m_date.strftime('%Y-%m-%d'),              
            "label": f"{month_names_vn[m-1]} / {active_year}", 
            "short_label": f"T{m}"                             
        })

    # Tính toán dự báo tự động
    forecasts = get_forecast_up_to(end_date, start_date=overlap_start)
    if not forecasts:
        return jsonify({"error": "Không thể tạo dữ liệu dự báo"}), 500

    # ── Chart data: SỬA LỖI ĐỂ TRẢ VỀ DỮ LIỆU ĐỘNG ──────────────────────
    chart_data = []
    # LOẠI BỎ KHAI BÁO LẠI TRÙNG LẶP (overlap_start đã được khai báo ở trên)
    overlap_end   = last_actual_date 
    
    for d in pd.date_range(overlap_start, end_date):
        actual_val = None
        if d <= overlap_end:
            # Lấy kèm giá trị thực tế lịch sử (nếu có) để truyền xuống vẽ tooltip đối chiếu
            actual_val = df_hist.loc[d, 'actual'] if (df_hist is not None and d in df_hist.index) else None
            if actual_val is not None:
                if hasattr(actual_val, 'iloc'): # Tránh lỗi trả về Series nếu dữ liệu trùng ngày
                    actual_val = actual_val.iloc[0]
                actual_val = float(actual_val)
            
        forecast_val = forecasts.get(d, None)
        lower_bound = None
        upper_bound = None
        
        if forecast_val is not None:
            lower_bound = round(max(0, forecast_val - 1.96 * mae_xgb), 1)
            upper_bound = round(forecast_val + 1.96 * mae_xgb, 1)
            forecast_val = round(forecast_val, 1)
            
        chart_data.append({
            "date": d.strftime('%Y-%m-%d'),
            "actual": actual_val,
            "forecast": forecast_val,
            "lower_bound": lower_bound,
            "upper_bound": upper_bound
        })

    # ─── CẢI TIẾN 1: TỰ ĐỘNG TÍNH TOÁN NGƯỠNG CẢNH BÁO ĐỘNG (Dữ liệu 90 ngày thực tế gần nhất) ───
    # Mặc định an toàn nếu không có lịch sử
    thresh_low = 2000.0
    thresh_warning = 4800.0
    thresh_high_warning = 5200.0
    thresh_emergency = 5500.0
    
    if df_hist is not None and len(df_hist) > 0:
        # Lấy 90 ngày dữ liệu thực tế cuối cùng
        recent_90_days = df_hist.tail(90)['actual']
        if len(recent_90_days) > 10:
            # Tính toán các bách phân vị di động thực tế
            thresh_warning = float(np.percentile(recent_90_days, 75))      # 75% bận rộn thường nhật
            thresh_high_warning = float(np.percentile(recent_90_days, 90)) # 90% tải trọng đỉnh
            thresh_emergency = float(np.percentile(recent_90_days, 95))    # 95% báo động quá tải cực đoan
            
    # Gửi các ngưỡng động này về Frontend để vẽ Thước đo và đồng bộ cảnh báo
    dynamic_thresholds = {
        "low": round(thresh_low, 1), # <──  DÒNG NÀY ĐỂ TRÁNH LỖI UNDEFINED Ở JS
        "warning": round(thresh_warning, 1),
        "high_warning": round(thresh_high_warning, 1),
        "emergency": round(thresh_emergency, 1)
    }

    # ─── KPIs cho khoảng hiển thị (Sử dụng ngưỡng động để đếm ngày tải cao) ────────────────
    display_range = pd.date_range(start_date, end_date)
    display_preds = []
    for d in display_range:
        if df_hist is not None and d in df_hist.index:
            val = df_hist.loc[d, 'actual']
            if hasattr(val, 'iloc'):
                val = val.iloc[0]
            display_preds.append(float(val))
        else:
            display_preds.append(forecasts.get(d, 4500.0))
            
    kpis = {
        "avg_daily":  int(np.mean(display_preds)),
        "peak_day":   int(np.max(display_preds)),
        "min_day":    int(np.min(display_preds)),
        "high_load_days": int(sum(1 for v in display_preds if v > thresh_warning)), # Sử dụng ngưỡng động cấp 1
        "mae":        round(mae_xgb, 1),
        "mape":       round(mape_xgb*100, 2),
        "confidence": round((1-mape_xgb)*100, 2)
    }

    # ── Monthly Summary (Ưu tiên lấy thực tế nếu có) ───────────────────────────
    month_names = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"June",
                   7:"July",8:"Aug",9:"Sept",10:"Oct",11:"Nov",12:"Dec"}
    months_in_range = sorted(set((d.year, d.month) for d in display_range))
    monthly_summary = []
    for yr, mn in months_in_range:
        mn_preds = []
        for d in display_range:
            if d.year == yr and d.month == mn:
                if df_hist is not None and d in df_hist.index:
                    val = df_hist.loc[d, 'actual']
                    if hasattr(val, 'iloc'):
                        val = val.iloc[0]
                    mn_preds.append(float(val))
                else:
                    mn_preds.append(forecasts.get(d, 4500.0))
        if mn_preds:
            monthly_summary.append({
                "Month": f"{month_names[mn]} {yr}",
                "Avg":   int(np.mean(mn_preds)),
                "Peak":  int(np.max(mn_preds)),
                "Min":   int(np.min(mn_preds)),
                "HighLoad": int(sum(1 for v in mn_preds if v>5000))
            })

    # ── Weekly average pattern (từ historical data 2025) ─────────────────
    weekly_pattern = []
    day_names = ["Thứ 2","Thứ 3","Thứ 4","Thứ 5","Thứ 6","Thứ 7","Chủ nhật"]
    if df_hist is not None:
        hist_2025 = df_hist[df_hist.index.year == 2025]
        for dow in range(7):
            vals = hist_2025[hist_2025.index.dayofweek == dow]['actual']
            weekly_pattern.append({
                "day": day_names[dow],
                "avg": int(vals.mean()) if len(vals) > 0 else 0
            })
    
    # ── Monthly historical comparison (2024 vs 2025) ──────────────────────
    monthly_hist_comparison = []
    if df_hist is not None:
        for mn in range(1, 13):
            row = {"month": month_names[mn]}
            for yr in [2024, 2025]:
                subset = df_hist[(df_hist.index.year==yr) & (df_hist.index.month==mn)]
                row[str(yr)] = int(subset['actual'].mean()) if len(subset) > 0 else 0
            monthly_hist_comparison.append(row)

    # ─── Heatmap (ĐỒNG BỘ NGƯỠNG ĐỘNG VỚI HỆ THỐNG CẢNH BÁO) ─────────────────
    hm_month = start_date.month
    hm_year  = start_date.year
    first_day = pd.to_datetime(f"{hm_year}-{hm_month:02d}-01")
    if hm_month == 12:
        last_day = pd.to_datetime(f"{hm_year}-12-31")
    else:
        last_day = pd.to_datetime(f"{hm_year}-{hm_month+1:02d}-01") - pd.Timedelta(days=1)
        
    heatmap_days = []
    for d in pd.date_range(first_day, last_day):
        v = forecasts.get(d, 4500.0)
        actual_val = float(df_hist.loc[d, 'actual']) if (df_hist is not None and d in df_hist.index) else None
            
        lower = max(0, v - 1.96 * mae_xgb)
        upper = v + 1.96 * mae_xgb
        
        # SỬ DỤNG NGƯỠNG ĐỘNG ĐỂ PHÂN LOẠI MÀU SẮC LỊCH
        if v > thresh_warning:
            lv, cc = "High", "red"
            rc = f"⚠️ Kịch bản tối đa {int(upper)} ca. Điều động khẩn cấp thêm Bác sĩ & Tăng cường quầy đón tiếp."
        elif v < thresh_low:
            lv, cc = "Low", "green"
            rc = "🟢 Tải thấp. Duy trì ca trực chuẩn, tạo điều kiện cho nhân viên nghỉ bù luân phiên."
        else:
            lv, cc = "Normal", "yellow"
            rc = f"🟡 Tải bình thường (Dự kiến tối đa {int(upper)} ca). Vận hành lâm sàng theo lịch trực thường nhật."
            
        heatmap_days.append({
            "date": d.strftime('%Y-%m-%d'), "day": d.day,
            "weekday": d.weekday(), "value": int(v),
            "actual_value": int(actual_val) if actual_val is not None else None,
            "lower_bound": int(lower),
            "upper_bound": int(upper),
            "load_level": lv, "color_class": cc, "recommendation": rc
        })

        # ─── Khuyến nghị động DSS dựa trên mức độ tải trọng thực tế (MỐC ĐỘNG THÍCH ỨNG) ───
    decision_warnings = []
    for d in display_range:
        if df_hist is not None and d in df_hist.index:
            v = float(df_hist.loc[d, 'actual'])
        else:
            v = forecasts.get(d, 4500.0)
            
        # Kích hoạt cảnh báo dựa trên các ngưỡng bách phân vị di động
        if v > thresh_warning:
            lower = max(0, v - 1.96 * mae_xgb)
            upper = v + 1.96 * mae_xgb
            
            recoms = []
            weekday_index = d.weekday()
            
            if upper >= thresh_emergency:
                recoms.extend([
                    f"🚨 BÁO ĐỘNG KHẨN CẤP (Kịch bản tải kịch trần lên tới {int(upper)} ca - Vượt mốc giới hạn đỏ {int(thresh_emergency)} ca của bệnh viện): Kích hoạt quy trình ứng phó khẩn cấp.",
                    "Huy động khẩn cấp +4 Bác sĩ lâm sàng dự phòng sảnh đón tiếp.",
                    "Tạm hoãn các cuộc hội chẩn hoặc lịch họp ban ngành không khẩn cấp trong ngày.",
                    "Mở toàn bộ quầy tiếp đón trực tiếp và khởi động các ki-ốt đăng ký tự động dự phòng."
                ])
            elif upper >= thresh_high_warning:
                recoms.extend([
                    f"⚠️ CẢNH BÁO CAO (Kịch bản tải kịch trần lên tới {int(upper)} ca - Vượt mốc cảnh báo cao {int(thresh_high_warning)} ca): Tăng cường thêm +2-3 Bác sĩ phòng khám.",
                    "Chuẩn bị mở thêm 2 quầy tiếp đón phụ trong khung giờ cao điểm sáng (07:00 - 10:00)."
                ])
            else:
                recoms.extend([
                    f"📢 CẢNH BÁO (Kịch bản tải kịch trần dự kiến {int(upper)} ca - Vượt mốc tải thường nhật {int(thresh_warning)} ca): Điều phối thêm +1 Bác sĩ trực dự phòng sảnh."
                ])
                
            if weekday_index == 0:
                recoms.append("⏱️ Lưu ý Thứ Hai đầu tuần: Đẩy nhanh tốc độ duyệt kết quả cận lâm sàng phòng Lab.")
            elif weekday_index == 4:
                recoms.append("🏥 Lưu ý Thứ Sáu cuối tuần: Đẩy nhanh các thủ tục xuất viện để giải phóng giường bệnh sảnh nội trú.")
                
            decision_warnings.append({
                "date": d.strftime('%d/%m/%Y'),
                "day_name": day_names[weekday_index],
                "value": int(v),
                "lower_bound": int(lower),
                "upper_bound": int(upper),
                "recoms": recoms
            })

    # ─── Feature Importance ĐỘNG THEO MODEL ĐANG ACTIVE ───
    feat_imp = []
    if model_xgb is not None:
        try:
            # Lấy danh sách độ quan trọng trực tiếp từ XGBoost hiện tại
            imp = model_xgb.feature_importances_
            # Map tương ứng với danh sách đặc trưng thực tế của model đó (8 hoặc 9 đặc trưng)
            feat_imp = [{"feature": f, "importance": float(i)}
                        for f, i in zip(features_xgb, imp)]
            # Sắp xếp giảm dần để đồ thị hiển thị đẹp mắt từ cao xuống thấp
            feat_imp = sorted(feat_imp, key=lambda x: x['importance'], reverse=True)
        except Exception as e:
            print(f"Lỗi tính toán Feature Importance động: {e}")
            feat_imp = []
            
            
    # ── Model Info (SỬA LỖI ĐỊNH DẠNG NGÀY KHÔNG CHUẨN) ───────────────────
    if isinstance(train_date_xgb, (datetime.datetime, pd.Timestamp)):
        train_date_str = train_date_xgb.strftime('%d/%m/%Y %H:%M')
    else:
        try:
            train_date_str = pd.to_datetime(train_date_xgb).strftime('%d/%m/%Y %H:%M')
        except:
            train_date_str = str(train_date_xgb)

    model_info = {
        "model_name":     model_name_xgb,
        "version":        version_xgb,
        "train_date":     train_date_str,
        "features_count": len(features_xgb),
        "features":       features_xgb,
        "mae":            round(mae_xgb, 1),
        "mape":           round(mape_xgb*100, 2)
    }

    zoom_start = start_date.strftime('%Y-%m-%d')
    zoom_end   = end_date.strftime('%Y-%m-%d')  

    return jsonify({
        "kpis": kpis,
        "chart_data": chart_data,
        "monthly_summary": monthly_summary,
        "weekly_pattern": weekly_pattern,
        "monthly_hist_comparison": monthly_hist_comparison,
        "heatmap": heatmap_days,
        "decision_support": decision_warnings,
        "feature_importance": feat_imp,
        "model_info": model_info,
        "zoom_start": zoom_start,
        "zoom_end": zoom_end,
        "selected_month": start_date.strftime('%Y-%m-%d'),
        "available_months": available_months,
        "dynamic_thresholds": dynamic_thresholds # <── Gửi mốc cảnh báo động về JS
    })


# ─── API 1: Tải danh sách tất cả mô hình trong thư mục ───────────────────────
@app.route('/api/models', methods=['GET'])
def list_models():
    bundle_folder = os.path.join(app.root_path, "model")
    active_model = get_active_model_filename()
    models = []
    try:
        for file in os.listdir(bundle_folder):
            if file.endswith(".pkl"):
                fpath = os.path.join(bundle_folder, file)
                try:
                    with open(fpath, "rb") as f:
                        b = pickle.load(f)
                    
                    train_date = b.get('train_date', '')
                    
                    # 1. CHUẨN HÓA MỐC THỜI GIAN THỰC TẾ ĐỂ SẮP XẾP CHRONOLOGICAL
                    if isinstance(train_date, (datetime.datetime, pd.Timestamp)):
                        sort_timestamp = pd.to_datetime(train_date)
                    else:
                        try:
                            sort_timestamp = pd.to_datetime(train_date)
                        except:
                            sort_timestamp = pd.Timestamp.min
                    
                    # 2. ĐỊNH DẠNG HIỂN THỊ VIỆT NAM CHO NGƯỜI DÙNG
                    if sort_timestamp != pd.Timestamp.min:
                        train_date_str = sort_timestamp.strftime('%d/%m/%Y %H:%M')
                    else:
                        train_date_str = str(train_date)
                        
                    models.append({
                        "filename": file,
                        "model_name": b.get('model_name', 'XGBoost'),
                        "version": b.get('version', 'v1.0'),
                        "train_date_raw": sort_timestamp,  # Key ẩn để phục vụ sắp xếp thời gian chuẩn xác
                        "train_date": train_date_str,
                        "mae": round(float(b.get('mae', 574.5)), 1),
                        "mape": round(float(b.get('mape', 0.1905)) * 100, 2),
                        "is_active": (file == active_model)
                    })
                except Exception as e:
                    print(f"Lỗi đọc file mô hình {file}: {e}")
                    pass
                    
        # SẮP XẾP THEO MỐC THỜI GIAN THỰC TẾ (CHRONOLOGICAL) TRƯỚC
        models.sort(key=lambda x: x['train_date_raw'], reverse=True)
        
        # XÓA KEY ẨN TRÁNH LỖI KHI CHUYỂN ĐỔI SANG JSON GỬI ĐI
        for m in models:
            m.pop('train_date_raw', None)
            
        return jsonify({"models": models})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── API 2: Huấn luyện mô hình Challenger mới (Không kích hoạt tự động) ──────
def get_adaptive_xgb_params(n_samples):
    """
    Tự động điều chỉnh siêu tham số XGBoost dựa trên quy mô dữ liệu thực tế (số lượng dòng).
    Đảm bảo mô hình tự động chuyển đổi từ cấu hình chống overfit (khi ít dữ liệu)
    sang cấu hình học sâu, nắm bắt chi tiết (khi dữ liệu lớn theo năm tháng).
    """
    if n_samples < 500:
        # GIAI ĐOẠN ĐẦU (Dữ liệu dưới 1.5 năm): Khống chế overfit tối đa
        return {
            "n_estimators": 150,
            "max_depth": 3,
            "learning_rate": 0.05,
            "subsample": 0.7,
            "colsample_bytree": 0.7,
            "reg_alpha": 15.0,
            "reg_lambda": 20.0,
            "min_child_weight": 4,
            "random_state": 42,
            "n_jobs": -1
        }
    elif n_samples < 1200:
        # GIAI ĐOẠN TRUNG HẠN (Dữ liệu từ 1.5 đến 3 năm): Tăng nhẹ dung lượng mô hình
        return {
            "n_estimators": 250,
            "max_depth": 4,
            "learning_rate": 0.03,
            "subsample": 0.75,
            "colsample_bytree": 0.75,
            "reg_alpha": 10.0,
            "reg_lambda": 15.0,
            "min_child_weight": 6,
            "random_state": 42,
            "n_jobs": -1
        }
    else:
        # GIAI ĐOẠN DÀI HẠN (Dữ liệu trên 3 năm): Khai thác triệt để các mẫu hình phức tạp
        return {
            "n_estimators": 400,
            "max_depth": 5,
            "learning_rate": 0.02,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "reg_alpha": 5.0,
            "reg_lambda": 10.0,
            "min_child_weight": 8,
            "random_state": 42,
            "n_jobs": -1
        }

@app.route('/api/retrain', methods=['POST'])
def retrain_model():
    if 'file' not in request.files:
        return jsonify({"error": "Không tìm thấy file dữ liệu tải lên."}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "Tên file không hợp lệ."}), 400
        
    try:
        # TỰ ĐỘNG PHÂN LOẠI FILE TẢI LÊN (CSV HOẶC EXCEL)
        filename = file.filename.lower()
        
        if filename.endswith('.csv'):
            df_new = pd.read_csv(file)
        elif filename.endswith('.xlsx') or filename.endswith('.xls'):
            df_new = pd.read_excel(file)
        else:
            return jsonify({"error": "Định dạng tệp không hợp lệ. Hệ thống chỉ hỗ trợ file .csv hoặc file excel (.xlsx / .xls)"}), 400
            
        df_new.columns = [c.strip().lower() for c in df_new.columns]
        if 'date' not in df_new.columns or 'actual' not in df_new.columns:
            return jsonify({"error": "File tải lên bắt buộc phải chứa cột 'date' và 'actual'."}), 400
            
        df_old = pd.read_csv(hist_path)
        df_old.columns = [c.strip().lower() for c in df_old.columns]
        
        df_all = pd.concat([df_old, df_new], ignore_index=True)
        df_all = df_all.dropna(subset=['date', 'actual'])
        df_all['date'] = df_all['date'].apply(parse_date)
        df_all = df_all.dropna(subset=['date', 'actual'])
        df_all = df_all.sort_values('date').drop_duplicates(subset=['date']).set_index('date')
        df_all.to_csv(hist_path)
        
        df_features = df_all.copy()
        df_features['lag_1'] = df_features['actual'].shift(1)
        df_features['lag_7'] = df_features['actual'].shift(7)
        df_features['lag_30'] = df_features['actual'].shift(30)
        df_features['rolling_mean_7'] = df_features['actual'].shift(1).rolling(window=7).mean()
        df_features['dayofweek'] = df_features.index.dayofweek
        df_features['month'] = df_features.index.month
        df_features['day'] = df_features.index.day
        df_features['is_weekend'] = df_features['dayofweek'].apply(lambda x: 1 if x >= 5 else 0)
        df_features['is_holiday'] = df_features.index.to_series().apply(check_is_holiday) 
        df_train = df_features.dropna()
        
        from xgboost import XGBRegressor
        from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error
        
        df_train = df_train.sort_index()
        
        # ─── CẢI TIẾN 1: KHÓA CỨNG TẬP KIỂM THỬ 30 NGÀY ───
        # Luôn lấy 30 ngày cuối cùng để đánh giá, phản ánh đúng năng lực dự báo tương lai
        test_horizon = 30
        if len(df_train) > test_horizon * 2:
            df_tr = df_train.iloc[:-test_horizon]
            df_te = df_train.tail(test_horizon)
        else:
            split_idx = int(len(df_train) * 0.8)
            df_tr = df_train.iloc[:split_idx]
            df_te = df_train.iloc[split_idx:]
        
        X_train = df_tr[FEATURES_WITH_HOLIDAY]
        y_train = df_tr['actual']
        
        X_test = df_te[FEATURES_WITH_HOLIDAY]
        y_test = df_te['actual']
        
        from xgboost import XGBRegressor
        from sklearn.metrics import mean_absolute_error
        
        # ─── CẢI TIẾN 2: CHỌN SIÊU THAM SỐ THÍCH ỨNG THEO QUY MÔ DỮ LIỆU ───
        n_samples = len(df_train)
        adaptive_params = get_adaptive_xgb_params(n_samples)
        
        # Huấn luyện mô hình đánh giá sai số (Challenger)
        eval_model = XGBRegressor(**adaptive_params)
        eval_model.fit(X_train, y_train)
        
        test_preds = eval_model.predict(X_test)
        new_mae = mean_absolute_error(y_test, test_preds)
        new_mape = calculate_wape(y_test, test_preds)
        
        # Huấn luyện mô hình Champion chính thức trên toàn bộ dữ liệu
        final_model = XGBRegressor(**adaptive_params)
        final_model.fit(df_train[FEATURES_WITH_HOLIDAY], df_train['actual'])
        
        # Cập nhật đầy đủ các biến toàn cục trong bộ nhớ đệm
        global model_xgb, mae_xgb, mape_xgb, train_date_xgb, df_hist, features_xgb, version_xgb, model_name_xgb
        model_xgb = final_model
        features_xgb = FEATURES_WITH_HOLIDAY 
        mae_xgb = float(new_mae)
        mape_xgb = float(new_mape)
        train_date_xgb = datetime.datetime.now()
        df_hist = df_all
        
        # ─── THAY ĐỔI ĐỊNH DẠNG TÊN PHIÊN BẢN VÀ FILE (ĐỀ XUẤT 2) ───
        # Lấy mốc dữ liệu mới nhất có trong tập dữ liệu sau khi gộp
        max_data_date = df_all.index.max()
        
        # Phiên bản hiển thị trực quan: "Học đến 31/05/2026"
        version_xgb = f"v{max_data_date.strftime('%d/%m/%y')}"
        
        # Tên tệp tin định dạng: xgb_to_31-05-2026_08h39.pkl
        date_str = max_data_date.strftime('%d-%m-%Y')
        time_str = datetime.datetime.now().strftime('%Hh%M')
        new_filename = f"xgb_to_{date_str}_{time_str}.pkl"
        # ──────────────────────────────────────────────────────────
        
        new_bundle_path = os.path.join(app.root_path, "model", new_filename)
        
        new_bundle = {
            'model': final_model,
            'features': FEATURES_WITH_HOLIDAY,
            'mae': new_mae,
            'mape': new_mape,
            'train_date': train_date_xgb,
            'version': version_xgb,
            'model_name': model_name_xgb
        }
        with open(new_bundle_path, "wb") as f:
            pickle.dump(new_bundle, f)
            
        _forecast_cache.clear()
        
        return jsonify({
            "success": True,
            "message": "Huấn luyện mô hình mới thành công! Vui lòng kiểm duyệt sai số và bấm Kích hoạt.",
            "filename": new_filename,
            "new_mae": round(new_mae, 1),
            "new_mape": round(new_mape * 100, 2)
        })
        
    except Exception as e:
        return jsonify({"error": f"Lỗi huấn luyện lại: {str(e)}"}), 500

# ─── API 3: Kích hoạt mô hình được chọn làm Champion chính thức ─────────────
@app.route('/api/activate', methods=['POST'])
def activate_model():
    data = request.json or {}
    filename = data.get("filename")
    if not filename:
        return jsonify({"error": "Không tìm thấy tên file cần kích hoạt"}), 400
        
    bundle_folder = os.path.join(app.root_path, "model")
    target_path = os.path.join(bundle_folder, filename)
    
    if not os.path.exists(target_path):
        return jsonify({"error": "Mô hình không tồn tại thực tế trên server"}), 404
        
    try:
        with open(target_path, "rb") as f:
            b = pickle.load(f)
            
        global model_xgb, mae_xgb, mape_xgb, train_date_xgb, df_hist, version_xgb, model_name_xgb, features_xgb
        model_xgb = b['model']
        # SỬA LỖI: Nếu là mô hình gốc (không chứa key 'features'), tự động mặc định nạp đúng 8 đặc trưng gốc - ko có holidays
        features_xgb = b.get('features', ['dayofweek', 'month', 'day', 'is_weekend', 'lag_1', 'lag_7', 'lag_30', 'rolling_mean_7'])  
        mae_xgb = float(b['mae'])
        mape_xgb = float(b['mape'])
        train_date_xgb = b.get('train_date', datetime.datetime.now())
        version_xgb = b.get('version', 'v1.1')
        model_name_xgb = b.get('model_name', 'Hospital_XGBoost')
        
        df_all = pd.read_csv(hist_path)
        df_all.columns = [c.strip().lower() for c in df_all.columns]
        df_all['date'] = df_all['date'].apply(parse_date)
        df_all = df_all.dropna(subset=['date', 'actual'])
        df_all = df_all.sort_values('date').drop_duplicates(subset=['date']).set_index('date')
        df_hist = df_all
        
        with open(active_config_path, "w") as f:
            json.dump({"active_model": filename}, f)
            
        _forecast_cache.clear()
        
        return jsonify({
            "success": True,
            "message": f"Kích hoạt thành công phiên bản mô hình: {filename}",
            "mae": round(mae_xgb, 1),
            "mape": round(mape_xgb * 100, 2)
        })
    except Exception as e:
        return jsonify({"error": f"Lỗi kích hoạt mô hình: {str(e)}"}), 500

# ─── API 4: Xóa mô hình không dùng (Trừ file gốc và file đang active) ────────
@app.route('/api/delete_model', methods=['POST'])
def delete_model():
    data = request.json or {}
    filename = data.get("filename")
    if not filename:
        return jsonify({"error": "Không tìm thấy tên file cần xóa"}), 400
        
    if filename == "hospital_xgb_bundle.pkl":
        return jsonify({"error": "Không được phép xóa phiên bản mô hình mặc định gốc của hệ thống"}), 400
        
    active_model = get_active_model_filename()
    if filename == active_model:
        return jsonify({"error": "Không thể xóa mô hình đang ở trạng thái Hoạt động"}), 400
        
    bundle_folder = os.path.join(app.root_path, "model")
    target_path = os.path.join(bundle_folder, filename)
    
    if os.path.exists(target_path):
        try:
            os.remove(target_path)
            return jsonify({"success": True, "message": f"Đã xóa thành công file mô hình {filename}"})
        except Exception as e:
            return jsonify({"error": f"Lỗi xóa file vật lý: {str(e)}"}), 500
    return jsonify({"error": "File mô hình không tồn tại"}), 404



if __name__ == '__main__':
    app.run(debug=True, threaded=True)