// Global State Variables
let currentHorizon = 30; 
let forecastData = null;
let mainChart = null;
let featChart = null;


// On Load Page Initialization
window.onload = function() {
    fetchForecastData();
    loadModelRegistry(); // Tự động tải danh sách mô hình khi vừa vào trang
    lucide.createIcons();
};

// Switch Horizon
function setHorizon(days) {
    currentHorizon = days;
    const buttons = document.querySelectorAll('#filter-horizon .segment-btn');
    buttons.forEach(btn => {
        if (parseInt(btn.getAttribute('data-val')) === days) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    fetchForecastData();
}

// On Filter dropdown change
function onFilterChange() {
    fetchForecastData();
}

// Main function to fetch data from Flask Backend API
async function fetchForecastData() {
    const monthSelect = document.getElementById('filter-month');
    const month = monthSelect.value;
    const url = `/api/forecast?month=${month}&horizon=${currentHorizon}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        forecastData = data;
        
        // --- Tự động vẽ Dropdown và Heatmap Tabs động ---
        if (data.available_months && data.selected_month) {
            renderDynamicFilters(data.available_months, data.selected_month);
        }
        // ---------------------------------------------------------------
        
        // Update Dashboard Elements
        updateKPIs(data.kpis);
        updateModelInfo(data.model_info);
        
        renderMainChart(data.chart_data, data.zoom_start, data.zoom_end); 
        renderFeatureImportance(data.feature_importance);
        renderSummaryTable(data.monthly_summary);
        renderHeatmap(data.heatmap);
        renderDecisionWarnings(data.decision_support, data.dynamic_thresholds);

        // ─── ĐỒNG BỘ: TỰ ĐỘNG NHẬN DIỆN NGÀY HÔM NAY THEO THỜI GIAN THỰC ───
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        
        const todayStr = `${yyyy}-${mm}-${dd}`;       // Sinh ra chuỗi định dạng "2026-06-11"
        const formattedToday = `${dd}/${mm}/${yyyy}`; // Sinh ra chuỗi định dạng "11/06/2026"

        let defaultDayValue = data.kpis.avg_daily;
        let defaultDateLabel = "Trung bình tháng";
        
        // Tìm ngày hôm nay trong chuỗi dữ liệu nhận được từ API
        const todayData = data.heatmap.find(d => d.date === todayStr);
        
        if (todayData) {
            defaultDayValue = todayData.value;
            defaultDateLabel = `Hôm nay (${formattedToday})`;
        } else if (data.heatmap.length > 0) {
            // Dự phòng nếu ngày hôm nay nằm ngoài khoảng hiển thị của biểu đồ
            const firstDay = data.heatmap[0];
            defaultDayValue = firstDay.value;
            const dateParts = firstDay.date.split('-');
            defaultDateLabel = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
        }
        
        // Vẽ thước đo mặc định ban đầu
        renderStressGauge(defaultDayValue, defaultDateLabel, data.dynamic_thresholds);
        
        // Cập nhật lại các icon nếu có thay đổi động trong HTML
        lucide.createIcons();
    } catch (err) {
        console.error("Lỗi khi tải dữ liệu dự báo từ backend:", err);
    }
}

// Update KPI card numbers
function updateKPIs(kpis) {
    document.getElementById('kpi-avg').textContent = kpis.avg_daily.toLocaleString('vi-VN');
    document.getElementById('kpi-peak').textContent = kpis.peak_day.toLocaleString('vi-VN');
    document.getElementById('kpi-mae').textContent = kpis.mae.toFixed(1);
    document.getElementById('kpi-mape').textContent = kpis.mape.toFixed(2) + "%";
    document.getElementById('kpi-confidence').textContent = kpis.confidence.toFixed(2) + "%";
}

// Update Model Metadata
function updateModelInfo(info) {
    document.getElementById('model-name-label').textContent = `${info.model_name} (${info.version})`;
    document.getElementById('model-train-date').textContent = info.train_date;
    document.getElementById('model-features-count').textContent = info.features_count;
    document.getElementById('model-mae-val').textContent = info.mae.toFixed(1);
    document.getElementById('model-mape-val').textContent = info.mape.toFixed(2) + "%";
    
    // Đồng bộ ngày huấn luyện động lên Header chính
    document.getElementById('meta-updated').textContent = formatDateVn(info.train_date);
    
    // Đồng bộ tên mô hình đang hoạt động lên Header chính
    document.getElementById('meta-model').textContent = `${info.model_name} ${info.version}`;
}

// Hàm bổ trợ chuyển đổi định dạng ngày YYYY-MM-DD sang DD/MM/YYYY
function formatDateVn(dateStr) {
    if (!dateStr) return "N/A";
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
}

// Render main forecast time series chart (using ApexCharts)
function renderMainChart(chartData, zoomStart, zoomEnd) {
    const dates = chartData.map(item => item.date);
    const actuals = chartData.map(item => item.actual);
    const forecasts = chartData.map(item => item.forecast);
    const lowerBounds = chartData.map(item => item.lower_bound);
    const upperBounds = chartData.map(item => item.upper_bound);

    // SỬA LỖI: Kiểm tra tính hợp lệ của ngày để phòng ngừa giá trị NaN gây sập đồ thị
    const minTime = (zoomStart && !isNaN(Date.parse(zoomStart))) ? new Date(zoomStart).getTime() : undefined;
    const maxTime = (zoomEnd && !isNaN(Date.parse(zoomEnd))) ? new Date(zoomEnd).getTime() : undefined;

    const series = [
        { name: 'Thực tế (Actual)', type: 'line', data: actuals },
        { name: 'Dự báo (Forecast)', type: 'line', data: forecasts },
        { name: 'Biên dưới (Lower Bound)', type: 'line', data: lowerBounds },
        { name: 'Biên trên (Upper Bound)', type: 'line', data: upperBounds }
    ];

    const options = {
        series: series,
        chart: {
            height: 350,
            type: 'line',
            foreColor: '#9ca3af', 
            background: 'transparent',
            toolbar: { show: true },
            animations: { enabled: true, easing: 'easeinout', speed: 500 }
        },
        stroke: {
            width: [3, 3, 1.5, 1.5],
            curve: 'smooth',
            dashArray: [0, 0, 4, 4]
        },
        colors: ['#10b981', '#3b82f6', '#f59e0b', '#f59e0b'],
        markers: {
            size: [4, 4, 0, 0],
            strokeWidth: 0,
            hover: { size: 6 }
        },
        xaxis: {
            type: 'datetime',
            categories: dates,
            // Sử dụng các mốc thời gian đã được xác thực an toàn
            min: minTime,
            max: maxTime,
            labels: {
                format: 'dd/MM/yyyy',
                style: { colors: '#9ca3af', fontSize: '11px' }
            }
        },
        yaxis: {
            title: {
                text: 'Số lượng lượt khám bệnh',
                style: { color: '#f3f4f6', fontWeight: 600 }
            },
            labels: { style: { colors: '#9ca3af' } }
        },
        grid: {
            borderColor: 'rgba(255, 255, 255, 0.05)',
        },
        tooltip: {
            theme: 'dark', 
            shared: true,
            x: { format: 'dd/MM/yyyy' }
        },
        annotations: {
            yaxis: [
                {
                    y: 0,
                    y2: 2000,
                    fillColor: '#10b981',
                    opacity: 0.03,
                    label: {
                        borderColor: 'transparent',
                        style: { color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', fontSize: '10px', fontWeight: 700 },
                        text: 'Tải thấp (<2k)'
                    }
                },
                {
                    y: 2000,
                    y2: 5000,
                    fillColor: '#f59e0b',
                    opacity: 0.03,
                    label: {
                        borderColor: 'transparent',
                        style: { color: '#fbbf24', background: 'rgba(245, 158, 11, 0.1)', fontSize: '10px', fontWeight: 700 },
                        text: 'Bình thường (2k-5k)'
                    }
                },
                {
                    y: 5000,
                    y2: 8000,
                    fillColor: '#ef4444',
                    opacity: 0.03,
                    label: {
                        borderColor: 'transparent',
                        style: { color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', fontSize: '10px', fontWeight: 700 },
                        text: 'Tải cao (>5k)'
                    }
                }
            ]
        }
    };

    if (mainChart) {
        mainChart.updateOptions(options);
    } else {
        mainChart = new ApexCharts(document.querySelector("#main-forecast-chart"), options);
        mainChart.render();
    }
}

// Bảng ánh xạ dịch nghĩa các đặc trưng kỹ thuật sang ngôn ngữ vận hành y tế
const featureTranslation = {
    'lag_1': 'Lượt khám hôm qua',
    'lag_7': 'Lượt khám cùng ngày tuần trước',
    'lag_30': 'Lượt khám cùng ngày tháng trước',
    'rolling_mean_7': 'Trung bình tải khám 7 ngày gần nhất',
    'dayofweek': 'Chu kỳ Thứ trong tuần',
    'month': 'Yếu tố Mùa / Tháng trong năm',
    'day': 'Ngày trong tháng',
    'is_weekend': 'Yếu tố ngày Cuối tuần',
    'is_holiday': 'Biến động ngày Nghỉ lễ'
};

function renderFeatureImportance(featImp) {
    // VIỆT HÓA NHÃN: Chuyển đổi tên đặc trưng từ API sang tiếng Việt rõ nghĩa
    const features = featImp.map(item => featureTranslation[item.feature] || item.feature);
    const importances = featImp.map(item => item.importance * 100);

    const options = {
        series: [{ name: 'Độ ảnh hưởng', data: importances }],
        chart: {
            type: 'bar',
            height: 240,
            foreColor: '#9ca3af',
            background: 'transparent',
            toolbar: { show: false }
        },
        plotOptions: {
            bar: {
                borderRadius: 4,
                horizontal: true,
                barHeight: '65%',
                distributed: true
            }
        },
        // Bảng màu tối ưu mượt mà cho sảnh tối
        colors: [
            '#2563eb', '#3b82f6', '#60a5fa', '#10b981', '#34d399', 
            '#a7f3d0', '#e2e8f0', '#64748b', '#475569', '#334155'
        ],
        dataLabels: {
            enabled: true,
            formatter: function (val) { return val.toFixed(1) + "%"; },
            style: { fontSize: '11px', colors: ['#fff'] }
        },
        xaxis: {
            categories: features,
            title: { text: 'Tỷ lệ đóng góp quyết định (%)', style: { color: '#9ca3af' } },
            labels: { style: { colors: '#9ca3af' } }
        },
        yaxis: {
            labels: { style: { colors: '#f3f4f6', fontWeight: 600, fontSize: '11px' } }
        },
        grid: { borderColor: 'rgba(255, 255, 255, 0.05)' },
        legend: { show: false },
        tooltip: { theme: 'dark' }
    };

    if (featChart) {
        featChart.updateOptions(options);
    } else {
        featChart = new ApexCharts(document.querySelector("#feature-importance-chart"), options);
        featChart.render();
    }
}

// Render Monthly Summary Table Rows
function renderSummaryTable(summary) {
    const tbody = document.getElementById('summary-table-body');
    tbody.innerHTML = '';
    summary.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 700; color: #60a5fa;">${row.Month}</td>
            <td>${row.Avg.toLocaleString('vi-VN')} <span class="badge bg-primary-light">lượt/ngày</span></td>
            <td><span class="badge bg-danger-light">${row.Peak.toLocaleString('vi-VN')}</span></td>
            <td><span class="badge bg-success-light">${row.Min.toLocaleString('vi-VN')}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// Render Calendar Heatmap for Selected Month
function renderHeatmap(heatmapDays) {
    const container = document.getElementById('calendar-cells-container');
    container.innerHTML = '';
    if (heatmapDays.length === 0) return;
    
    const firstDayOffset = heatmapDays[0].weekday;
    for (let i = 0; i < firstDayOffset; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.classList.add('calendar-cell', 'cell-empty');
        container.appendChild(emptyCell);
    }
    
    heatmapDays.forEach(day => {
            const cell = document.createElement('div');
            cell.classList.add('calendar-cell', `cell-${day.color_class}`);
            
            const dateParts = day.date.split('-');
            const formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
            
            // KIỂM TRA: Vẽ thêm hàng số liệu Thực tế nếu có
            let actualRowHtml = '';
            if (day.actual_value !== undefined && day.actual_value !== null) {
                actualRowHtml = `
                    <div class="tooltip-row" style="margin-top: 2px; font-size: 10px; color: #10b981; font-weight: 700;">
                      <span>Thực tế (Actual):</span>
                      <strong>${day.actual_value.toLocaleString('vi-VN')} lượt</strong>
                  </div>
                `;
            }
            
            cell.innerHTML = `
                <span class="day-num">${day.day}</span>
                <span class="day-value">${day.value.toLocaleString('vi-VN')}</span>
                
                <div class="tooltip-card">
                    <div class="tooltip-title">Ngày ${formattedDate}</div>
                    <div class="tooltip-row">
                        <span>Dự báo (Forecast):</span>
                        <strong>${day.value.toLocaleString('vi-VN')} lượt</strong>
                    </div>
                    ${actualRowHtml}
                    <div class="tooltip-row" style="margin-top: 2px; font-size: 10px; color: #fbbf24;">
                        <span>Khoảng (95% CI):</span>
                        <strong>${day.lower_bound.toLocaleString('vi-VN')} - ${day.upper_bound.toLocaleString('vi-VN')} ca</strong>
                    </div>
                    <div class="tooltip-row" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.08);">
                        <span>Mức độ tải:</span>
                        <span class="badge ${day.color_class === 'red' ? 'bg-danger-light' : day.color_class === 'yellow' ? 'bg-primary-light' : 'bg-success-light'}">
                            ${day.load_level === 'High' ? '🔴 TẢI CAO' : day.load_level === 'Normal' ? '🟡 BÌNH THƯỜNG' : '🟢 TẢI THẤP'}
                        </span>
                    </div>
                    <div class="tooltip-recom">${day.recommendation}</div>
                </div>
            `;
            cell.onclick = function() {
                // Quay kim Thước đo áp lực sảnh khám tương tác thời gian thực
                renderStressGauge(day.value, formattedDate, forecastData.dynamic_thresholds);
            };
            container.appendChild(cell);
        });
}

// Thay đổi trạng thái hoạt động của các tab (May -> Dec)
function updateHeatmapTabState(monthValue) {
    const tabs = document.querySelectorAll('#calendar-tabs-container .calendar-tab');
    tabs.forEach(btn => {
        if (btn.id === `tab-${monthValue}`) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Heatmap Tab Switch Handler
async function switchHeatmapMonth(monthValue) {
    document.getElementById('filter-month').value = monthValue;
    fetchForecastData();
}

// Render Decision Support Warnings (Hàm vẽ cảnh báo động DSS)
//  nhóm đa tầng tối ưu
// Sửa lại cảnh báo không đúng do đã chuyển sang sinh tháng tự động
// Thêm tính năng cảnh báo động tùy thuộc lưu lượng bệnh nhân 3 tháng gần nhất
function renderDecisionWarnings(warnings, thresholds) {
    const container = document.getElementById('dss-warnings-container');
    container.innerHTML = '';
    
    // Lấy các ngưỡng động từ API, dự phòng số cứng cũ nếu dữ liệu lỗi
    const t_low = thresholds ? thresholds.low : 2000;
    const t_warn = thresholds ? thresholds.warning : 5000;
    const t_high = thresholds ? thresholds.high_warning : 5200;
    const t_emerg = thresholds ? thresholds.emergency : 5500;
    
    // Lọc danh sách cảnh báo của tháng đang chọn
    const selectedMonthStr = document.getElementById('filter-month').value;
    let selectedMonthNum = "06"; 
    
    if (selectedMonthStr && selectedMonthStr !== 'auto') {
        const parts = selectedMonthStr.split('-');
        if (parts.length === 3) {
            selectedMonthNum = parts[1];
        }
    }
    
    const filteredWarnings = warnings.filter(item => {
        const dateParts = item.date.split('/');
        return dateParts[1] === selectedMonthNum; 
    });
    
    
    // TRƯỜNG HỢP 1: THÁNG ĐANG CHỌN VẬN HÀNH TIÊU CHUẨN (KHÔNG CÓ CẢNH BÁO ĐỎ CỰC ĐOAN)
    if (filteredWarnings.length === 0) {
        const heatmapDays = (forecastData && forecastData.heatmap) ? forecastData.heatmap : [];
        
        if (heatmapDays && heatmapDays.length > 0) {
            const validDays = heatmapDays.filter(d => d.value !== undefined && d.day !== undefined);
            
            if (validDays.length > 0) {
                const dayNamesShort = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
                
                // 1. Tự động tính toán trung bình tháng hiện tại (Ví dụ: 3.767 ca)
                const monthAvg = Math.round(validDays.reduce((acc, d) => acc + d.value, 0) / validDays.length);
                
                // 2. Sắp xếp toàn bộ ngày trong tháng giảm dần để tìm đỉnh cao
                const sortedAllDays = [...validDays].sort((a, b) => b.value - a.value);
                
                // Luôn lấy đúng 3 ngày bận nhất tháng làm badge nổi bật sảnh chính
                const topBusiest = sortedAllDays.slice(0, 3);
                
                // ─── THIẾT LẬP NGƯỠNG BẬN RỘN CHỌN LỌC (MIDPOINT) ĐỂ LỌC BỚT TRÀN THÔNG TIN ───
                // Ngưỡng bận rộn thực tế = Trung bình tháng + (Ngưỡng đỏ - Trung bình tháng) / 2
                //  3767 + (6617 - 3767) * 0.5 = ~5.192 ca
                const busyThreshold = Math.round(monthAvg + (t_warn - monthAvg) * 0.5);
                
                // Chỉ lấy các ngày còn lại (từ vị trí thứ 4 trở đi) có giá trị vượt ngưỡng chọn lọc này
                const remainingBusy = sortedAllDays.slice(3).filter(d => d.value >= busyThreshold && d.value < t_warn);
                const remainingCount = remainingBusy.length;
                
                // Hàm định dạng nhãn ngày gọn gàng (Ví dụ: T2 ngày 15/06)
                const formatDayLabel = (d) => {
                    const paddedDay = d.day < 10 ? `0${d.day}` : d.day;
                    return `${dayNamesShort[d.weekday]} ngày ${paddedDay}/${selectedMonthNum}`;
                };

                // Thiết lập khung Tooltip nổi tương tác
                let remainingText = '';
                if (remainingCount > 0) {
                    const minVal = Math.round(remainingBusy[remainingBusy.length - 1].value).toLocaleString('vi-VN');
                    const maxVal = Math.round(remainingBusy[0].value).toLocaleString('vi-VN');
                    
                    const remainingListHtml = remainingBusy.map(d => `
                        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.03); padding: 5px 0; font-size: 10px; font-family: 'Inter', sans-serif;">
                            <span style="color: var(--text-muted);">📅 ${formatDayLabel(d)}:</span>
                            <strong style="color: #60a5fa;">${Math.round(d.value).toLocaleString('vi-VN')} ca</strong>
                        </div>
                    `).join('');

                    remainingText = `
                        <span class="dynamic-tooltip-container" 
                              style="position: relative; display: inline-block; cursor: help; vertical-align: middle;"
                              onmouseenter="const t = this.querySelector('.dynamic-tooltip-box'); if(t) { t.style.opacity = '1'; t.style.visibility = 'visible'; t.style.transform = 'translateX(-50%) translateY(0)'; }"
                              onmouseleave="const t = this.querySelector('.dynamic-tooltip-box'); if(t) { t.style.opacity = '0'; t.style.visibility = 'hidden'; t.style.transform = 'translateX(-50%) translateY(8px)'; }">
                            
                            <span style="font-size: 11px; color: var(--text-muted); font-style: italic; border-bottom: 1px dashed rgba(255,255,255,0.3); padding-bottom: 1px;">
                                và +${remainingCount} ngày bận rộn khác (dao động từ ${minVal} đến ${maxVal} ca)
                            </span>
                            
                            <span class="dynamic-tooltip-box" style="
                                opacity: 0;
                                visibility: hidden;
                                transition: opacity 0.15s ease-out, transform 0.15s ease-out;
                                position: absolute;
                                bottom: 100%;
                                margin-bottom: 4px;
                                left: 50%;
                                transform: translateX(-50%) translateY(8px);
                                background: #111827;
                                color: #f3f4f6;
                                padding: 14px;
                                border-radius: var(--radius-md);
                                width: 260px;
                                box-shadow: 0 12px 35px rgba(0,0,0,0.9);
                                border: 1px solid rgba(255,255,255,0.1);
                                z-index: 999;
                                font-style: normal;
                                line-height: 1.5;
                                text-align: left;
                                pointer-events: auto;
                            ">
                                <strong style="color: #fbbf24; font-size: 11px; display: block; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 8px; font-family: 'Outfit', sans-serif;">
                                    📋 Chi tiết các ngày bận rộn khác:
                                </strong>
                                <div style="max-height: 160px; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column;">
                                    ${remainingListHtml}
                                </div>
                            </span>
                        </span>
                    `;
                }

                // Sắp xếp tăng dần để tìm Top 3 ngày vắng nhất tháng (tiêu chuẩn)
                const topQuietest = [...validDays].sort((a, b) => a.value - b.value).slice(0, 3);

                let htmlContent = `
                    <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); padding: 16px; border-radius: var(--radius-md); margin-bottom: 15px; box-shadow: var(--shadow-sm);">
                        <span style="color: var(--success); font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 8px;">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: var(--success); display: inline-block; box-shadow: 0 0 8px var(--success);"></span>
                            DỰ BÁO: VẬN HÀNH TIÊU CHUẨN
                        </span>
                        <p style="font-size: 11px; color: var(--text-muted); line-height: 1.5; margin-top: 8px;">
                            Dự báo trong tháng này, lượt khám hàng ngày sẽ vận hành ổn định và <strong>không có ngày nào vượt mức áp lực bận rộn thực tế</strong> (<strong style="color: white;">${Math.round(t_warn).toLocaleString('vi-VN')} ca/ngày</strong> - giới hạn bận rộn tính theo tải thực tế 3 tháng gần nhất). Lượt khám trung bình của tháng dự kiến là <strong style="color: #3b82f6;">${monthAvg.toLocaleString('vi-VN')} ca/ngày</strong>.
                        </p>
                    </div>

                    <!-- ─── TOP 3 NGÀY ĐÔNG NHẤT THÁNG KÈM THEO TOOLTIP DANH SÁCH CHỌN LỌC ─── -->
                    <div class="dss-item" style="border-left-color: var(--warning); background: rgba(245, 158, 11, 0.05); border-top-color: rgba(245, 158, 11, 0.1); border-right-color: rgba(245, 158, 11, 0.1); border-bottom-color: rgba(245, 158, 11, 0.1); margin-bottom: 15px;">
                        <div class="dss-item-header">
                            <span class="date-label" style="color: #fbbf24; font-weight: 700;">🔥 Các ngày cao điểm trong tháng (Xếp giảm dần từ đông nhất)</span>
                        </div>
                        <div style="margin: 8px 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; position: relative;">
                            ${topBusiest.map(d => `
                                <span class="badge bg-primary-light" style="font-size: 10px; border: 1px solid rgba(245,158,11,0.2); padding: 4px 8px; color: #fbbf24;">
                                    ${formatDayLabel(d)}: <strong>${d.value.toLocaleString('vi-VN')}</strong> ca
                                </span>
                            `).join('')}
                            ${remainingText}
                        </div>
                        <ul class="dss-item-recoms" style="margin-top: 4px;">
                            <li>Bảng danh sách trên hiển thị 3 ngày cao điểm nhất. Cụm ngày bận rộn lân cận (nếu có) biểu thị các ngày có lượng khám tiệm cận vùng đỏ (dự báo từ <strong style="color: white;">${busyThreshold.toLocaleString('vi-VN')} ca/ngày</strong> trở lên).</li>
                            <li><strong>Khuyến nghị vận hành thường nhật:</strong> Duy trì tua trực lâm sàng chuẩn của bệnh viện. Chỉ cần lưu ý nhân sự đi trực đúng giờ và sẵn sàng mở toàn bộ các quầy tiếp đón chính vào khung giờ cao điểm sáng (07:00 - 09:30) để sảnh luôn được thông suốt.</li>
                            <li>Nhân viên y tế vẫn được nghỉ phép theo kế hoạch định kỳ bình thường, nhưng hạn chế dồn các lịch họp ban ngành kéo dài hoặc lịch đào tạo nội bộ trùng vào nhóm ngày này.</li>
                        </ul>
                    </div>

                    <!-- ─── TOP 3 NGÀY VẮNG NHẤT THÁNG ─── -->
                    <div class="dss-item" style="border-left-color: var(--success); background: rgba(16, 185, 129, 0.05); border-top-color: rgba(16, 185, 129, 0.1); border-right-color: rgba(16, 185, 129, 0.1); border-bottom-color: rgba(16, 185, 129, 0.1); margin-bottom: 15px;">
                        <div class="dss-item-header">
                            <span class="date-label" style="color: #34d399; font-weight: 700;">🍃 3 ngày thông thoáng nhất sảnh khám (Thấp tải)</span>
                        </div>
                        <div style="margin: 8px 0; display: flex; flex-wrap: wrap; gap: 6px;">
                            ${topQuietest.map(d => `
                                <span class="badge bg-success-light" style="font-size: 10px; border: 1px solid rgba(16,185,129,0.2); padding: 4px 8px; color: #34d399;">
                                    ${formatDayLabel(d)}: <strong>${d.value.toLocaleString('vi-VN')}</strong> ca
                                </span>
                            `).join('')}
                        </div>
                        <ul class="dss-item-recoms" style="margin-top: 4px;">
                            <li>Lượng bệnh nhân đến khám thưa thớt, công suất sảnh khám cực kỳ thông thoáng.</li>
                            <li><strong>Khuyến nghị:</strong> Ưu tiên sắp xếp duyệt nghỉ phép năm hoặc nghỉ bù cho nhân viên y tế vào các ngày này.</li>
                        </ul>
                    </div>
                `;

                container.innerHTML = htmlContent;
                return;
            }
        }
    }
    
    // TRƯỜNG HỢP 2: CÓ CẢNH BÁO ĐỎ (ĐÃ ĐƯỢC BACKEND TÍNH TOÁN THEO NGƯỠNG ĐỘNG)
    filteredWarnings.forEach(item => {
        const div = document.createElement('div');
        div.classList.add('dss-item');
        
        let recomsHtml = '';
        item.recoms.forEach(rec => {
            recomsHtml += `<li>${rec}</li>`;
        });
        
        div.innerHTML = `
            <div class="dss-item-header" style="margin-bottom: 4px;">
                <span class="date-label">${item.day_name}, ngày ${item.date}</span>
                <span class="val-label">Dự báo: <strong style="color: white;">${item.value.toLocaleString('vi-VN')} lượt</strong></span>
            </div>
            <div style="font-size: 11px; color: #9ca3af; margin-bottom: 10px; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 6px; font-family: 'Outfit', sans-serif;">
                Dao động tin cậy (95% CI): <strong style="color: #fbbf24;">${item.lower_bound.toLocaleString('vi-VN')} ca</strong> đến <strong style="color: #f87171;">${item.upper_bound.toLocaleString('vi-VN')} ca</strong>
            </div>
            <ul class="dss-item-recoms">
                ${recomsHtml}
            </ul>
        `;
        container.appendChild(div);
    });
}


// Simple HTML Escaper
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* QUẢN LÝ MÔ HÌNH VÀ HUÂN LUYỆN LẠI */

// Tải danh sách tất cả mô hình trong Registry vẽ lên giao diện
async function loadModelRegistry() {
    try {
        const response = await fetch("/api/models");
        const data = await response.json();
        
        const tbody = document.getElementById('model-registry-tbody');
        tbody.innerHTML = '';
        
        const controlSelect = document.getElementById('control-model-select');
        if (controlSelect) controlSelect.innerHTML = '';
        
        if (!data.models || data.models.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">Chưa có mô hình nào.</td></tr>`;
            return;
        }
        
        // Tự động tìm mô hình có dữ liệu mới nhất (backend đã sắp xếp giảm dần nên phần tử 0 luôn mới nhất)
      let latestModelFilename = "";
      if (data.models.length > 0) {
          latestModelFilename = data.models[0].filename;
      }

        data.models.forEach(model => {
            const tr = document.createElement('tr');
            let shortName = model.filename === "hospital_xgb_bundle.pkl" ? "Gốc (Default)" : model.version;
            
            if (controlSelect) {
                const opt = document.createElement('option');
                opt.value = model.filename;
                // Thêm nhãn ⭐ vào dropdown bộ lọc chính
                const recommendedText = model.filename === latestModelFilename ? " ⭐ Khuyên dùng" : "";
                opt.textContent = `${shortName} ${recommendedText} (WAPE: ${model.mape}%)`;
                if (model.is_active) {
                    opt.selected = true; 
                }
                controlSelect.appendChild(opt);
            }
            
            let statusBadge = `<span class="badge bg-success-light" style="font-size: 9px; padding: 2px 6px;">Active</span>`;
            let actionButtons = `<span style="color: var(--text-muted); font-style: italic;">Đang chạy</span>`;
            
            if (!model.is_active) {
                statusBadge = `<span class="badge bg-primary-light" style="font-size: 9px; padding: 2px 6px; background-color: rgba(255,255,255,0.03); color: #6b7280; border: 1px solid rgba(255,255,255,0.05);">Offline</span>`;
                
                // Chỉ hiển thị nút "Xóa" nếu mô hình đó không phải là mô hình gốc của hệ thống
                let deleteButtonHtml = "";
                if (model.filename !== "hospital_xgb_bundle.pkl") {
                    deleteButtonHtml = `<button onclick="deleteModel('${model.filename}')" class="segment-btn" style="font-size: 10px; padding: 4px 10px; cursor: pointer; color: var(--danger); margin-left: 4px; background: transparent; border: 1px solid var(--border-color);">Xóa</button>`;
                }

                actionButtons = `
                    <button onclick="activateModel('${model.filename}')" class="segment-btn active" style="font-size: 10px; padding: 4px 10px; cursor: pointer; background-color: var(--primary);">Kích hoạt</button>
                    ${deleteButtonHtml}
                `;
            }
            
            // Vẽ huy hiệu ⭐ 
            const recommendedBadge = model.filename === latestModelFilename 
                ? `<span class="badge bg-warning-light" style="font-size: 8px; padding: 2px 6px; color: #fbbf24; border: 1px solid rgba(245,158,11,0.2); margin-left: 6px;">⭐ Khuyên dùng (AI)</span>`
                : "";

            tr.innerHTML = `
                <td style="padding: 10px 12px; font-weight: 700; color: #f3f4f6;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        ${shortName} ${recommendedBadge}
                    </div>
                    <span style="font-size: 10px; font-weight: 500; color: var(--text-muted); display: block; margin-top: 2px;">Huấn luyện lúc: ${model.train_date}</span>
                </td>
                <td style="padding: 10px 12px; text-align: center; color: #fbbf24; font-weight: 700;">${model.mae}</td>
                <td style="padding: 10px 12px; text-align: center; color: #34d399; font-weight: 700;">${model.mape}%</td>
                <td style="padding: 10px 12px; text-align: center;">${statusBadge}</td>
                <td style="padding: 10px 12px; text-align: right;">${actionButtons}</td>
            `;
            tbody.appendChild(tr);
        });
        
        lucide.createIcons();
    } catch (err) {
        console.error("Lỗi khi tải Model Registry:", err);
    }
}

// Hàm xử lý khi người dùng chọn thay đổi mô hình ở Bộ lọc chính
async function onControlModelChange() {
    const filename = document.getElementById('control-model-select').value;
    activateModel(filename); 
}

// Kích hoạt gửi file huấn luyện mô hình mới (Challenger)
async function triggerRetrain() {
    const fileInput = document.getElementById('upload-csv-file');
    if (fileInput.files.length === 0) {
        alert("Vui lòng lựa chọn một tệp dữ liệu (.csv) mới trước khi kích hoạt huấn luyện!");
        return;
    }
    
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    
    alert("Hệ thống bắt đầu tải tệp lên và tự động kích hoạt tiến trình huấn luyện lại mô hình XGBoost. Vui lòng chờ vài giây...");
    
    try {
        const response = await fetch("/api/retrain", {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        
        if (data.success) {
            alert(`Huấn luyện thành công!\nMô hình mới được tạo: ${data.filename}\nSai số MAE mới đạt: ${data.new_mae}\nSai số MAPE mới đạt: ${data.new_mape}%\n\nHãy tìm tên mô hình trên bảng Registry để tiến hành kiểm duyệt và Kích hoạt!`);
            fileInput.value = ''; 
            loadModelRegistry(); 
        } else {
            alert("Lỗi huấn luyện: " + data.error);
        }
    } catch (err) {
        console.error(err);
        alert("Đã xảy ra lỗi kết nối với máy chủ huấn luyện.");
    }
}

// Kích hoạt một mô hình làm mô hình Champion chính thức
async function activateModel(filename) {
    if (!confirm(`Bạn có chắc chắn muốn kích hoạt phiên bản mô hình này: ${filename}? Hệ thống sẽ tính toán lại toàn bộ dự báo theo mô hình mới.`)) {
        return;
    }
    
    try {
        const response = await fetch("/api/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: filename })
        });
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            
            fetchForecastData();
            loadModelRegistry(); 
        } else {
            alert("Lỗi kích hoạt: " + data.error);
        }
    } catch (err) {
        console.error(err);
        alert("Đã xảy ra lỗi kết nối khi kích hoạt mô hình.");
    }
}

// Xóa mô hình không sử dụng khỏi hệ thống
async function deleteModel(filename) {
    if (!confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn tệp mô hình này: ${filename}? Thao tác này không thể hoàn tác.`)) {
        return;
    }
    
    try {
        const response = await fetch("/api/delete_model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: filename })
        });
        const data = await response.json();
        
        if (data.success) {
            alert(data.message);
            loadModelRegistry(); 
        } else {
            alert("Lỗi khi xóa: " + data.error);
        }
    } catch (err) {
        console.error(err);
        alert("Đã xảy ra lỗi kết nối khi thực hiện xóa.");
    }
}

// Tự động trích xuất dữ liệu dự báo trên biểu đồ và xuất thành file CSV
function downloadForecastCSV() {
    if (!forecastData || !forecastData.chart_data || !forecastData.zoom_start || !forecastData.zoom_end) {
        alert("Không có dữ liệu dự báo hiện tại để xuất báo cáo!");
        return;
    }
    
    const startTime = new Date(forecastData.zoom_start).getTime();
    const endTime = new Date(forecastData.zoom_end).getTime();
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Ngay,Luot thuc te (Actual),Luot du bao (Forecast),Bien duoi (Lower Bound),Bien tren (Upper Bound)\r\n";
    
    forecastData.chart_data.forEach(item => {
        const itemTime = new Date(item.date).getTime();
        
        if (itemTime >= startTime && itemTime <= endTime) {
            const actual = item.actual !== null ? item.actual : "";
            const forecast = item.forecast !== null ? item.forecast : "";
            const lower = item.lower_bound !== null ? item.lower_bound : "";
            const upper = item.upper_bound !== null ? item.upper_bound : "";
            
            csvContent += `${item.date},${actual},${forecast},${lower},${upper}\r\n`;
        }
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    // --- NÂNG CẤP: TỰ ĐỘNG CHUYỂN ĐỔI TÊN FILE CHUẨN ĐỊNH DẠNG "thang_x_yyyy" ---
    const activeMonth = document.getElementById('filter-month').value; // Ví dụ: "2026-01-01"
    let filenameSuffix = "bao_cao";
    
    if (activeMonth && activeMonth !== 'auto') {
        const parts = activeMonth.split('-'); // Tách chuỗi ["2026", "01", "01"]
        if (parts.length === 3) {
            const year = parts[0];             // Lấy năm "2026"
            const month = parseInt(parts[1], 10); // Chuyển "01" thành số nguyên 1
            filenameSuffix = `thang_${month}_${year}`; // Kết quả dạng "thang_1_2026"
        }
    }
    
    // Thiết lập tên file động sạch sẽ cho báo cáo CSV tải về
    link.setAttribute("download", `Bao_cao_du_bao_kham_benh_${filenameSuffix}.csv`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
}

// Hàm vẽ động dropdown Bộ lọc tháng và các Tab chuyển lịch sảnh dưới theo Năm hoạt động
function renderDynamicFilters(availableMonths, selectedMonthValue) {
    const selectEl = document.getElementById('filter-month');
    const tabsContainer = document.getElementById('calendar-tabs-container');
    
    // 1. Vẽ Dropdown options (Chỉ vẽ lại nếu danh sách options rỗng)
    if (selectEl.options.length <= 1) { 
        availableMonths.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.value; // Ví dụ: "2026-01-01"
            opt.textContent = m.label; // Ví dụ: "Tháng 1 / 2026"
            selectEl.appendChild(opt);
        });
    }
    
    // 2. Vẽ Heatmap tabs (Chỉ vẽ lại khi container rỗng)
    if (tabsContainer.children.length === 0) {
        availableMonths.forEach(m => {
            const btn = document.createElement('button');
            btn.className = 'calendar-tab';
            btn.id = `tab-${m.value}`;
            btn.textContent = m.short_label; // Ví dụ: "T1"
            btn.onclick = () => switchHeatmapMonth(m.value);
            tabsContainer.appendChild(btn);
        });
    }
    
    // Cập nhật trạng thái được chọn hoạt động cho đồng bộ sảnh hiển thị
    if (selectedMonthValue) {
        selectEl.value = selectedMonthValue;
        updateHeatmapTabState(selectedMonthValue);
    }
}

// Hàm tính oán và vẽ thước đo áp lưc
let stressGaugeChart = null;

// Hàm nội suy phân mảnh tính toán Chỉ số áp lực phần trăm
function calculateStressIndex(v, thresholds) {
    // Cải tiến kiểm tra an toàn: nếu thresholds tồn tại và có thuộc tính tương ứng thì dùng, ngược lại dùng fallback mặc định
    const t_low = (thresholds && thresholds.low !== undefined) ? thresholds.low : 2000;
    const t_warn = (thresholds && thresholds.warning !== undefined) ? thresholds.warning : 5000;
    const t_emerg = (thresholds && thresholds.emergency !== undefined) ? thresholds.emergency : 5500;
    
    let pct = 0;
    let statusText = "";
    let color = "#10b981"; // Màu xanh lục
    
    if (v <= t_low) {
        pct = Math.round((v / t_low) * 30);
        statusText = "🟢 Tải thấp - Sảnh thông thoáng";
        color = "#10b981";
    } else if (v <= t_warn) {
        pct = Math.round(30 + ((v - t_low) / (t_warn - t_low)) * 45);
        statusText = "🟡 Bình thường - Vận hành tiêu chuẩn";
        color = "#fbbf24"; // Màu vàng
    } else if (v <= t_emerg) {
        pct = Math.round(75 + ((v - t_warn) / (t_emerg - t_warn)) * 20);
        statusText = "🟠 Tải cao - Sảnh bận rộn";
        color = "#f97316"; // Màu cam sảnh bận
    } else {
        pct = Math.round(Math.min(100, 95 + ((v - t_emerg) / (t_emerg * 0.2)) * 5));
        statusText = "🚨 Báo động - Sảnh quá tải cực đoan!";
        color = "#ef4444"; // Màu đỏ quá tải
    }
    
    return { pct, statusText, color };
}

// Hàm vẽ/Cập nhật Thước đo Áp lực sảnh khám
function renderStressGauge(value, dateLabel, thresholds) {
    const { pct, statusText, color } = calculateStressIndex(value, thresholds);
    
    // Cập nhật các thẻ nhãn chữ bên dưới thước đo
    document.getElementById('gauge-date-label').textContent = `Đang xem ngày: ${dateLabel}`;
    const statusEl = document.getElementById('gauge-status-label');
    statusEl.textContent = statusText;
    statusEl.style.color = color;
    document.getElementById('gauge-value-label').innerHTML = `Dự kiến: <strong style="color: white;">${Math.round(value).toLocaleString('vi-VN')}</strong> ca`;

    const options = {
        series: [pct],
        chart: {
            type: 'radialBar',
            height: 150,
            sparkline: { enabled: true }
        },
        plotOptions: {
            radialBar: {
                startAngle: -90,
                endAngle: 90,
                track: {
                    background: "rgba(255, 255, 255, 0.05)",
                    strokeWidth: '85%',
                    margin: 0
                },
                dataLabels: {
                    name: { show: false },
                    value: {
                        offsetY: -5,
                        fontSize: '18px',
                        fontWeight: '700',
                        fontFamily: 'Outfit, sans-serif',
                        color: '#ffffff',
                        formatter: function (val) {
                            return val + "%";
                        }
                    }
                }
            }
        },
        grid: {
            padding: {
                top: -10,
                bottom: -10
            }
        },
        fill: {
            colors: [color] //Đồng bộ màu động theo mức độ quá tải
        },
        labels: ['Áp lực sảnh']
    };

    if (stressGaugeChart) {
        stressGaugeChart.updateOptions(options);
    } else {
        stressGaugeChart = new ApexCharts(document.querySelector("#stress-gauge-chart"), options);
        stressGaugeChart.render();
    }
}