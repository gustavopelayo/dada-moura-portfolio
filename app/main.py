from fastapi import FastAPI, Form, Depends, UploadFile, File, Cookie, Response, Query
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.requests import Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
import uvicorn
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from app.api.v1.endpoints import portfolio, auth
from app.models.user import User
from app.api.deps import get_admin_user, NotAuthenticatedException
from app.db.session import get_db
from app.core.security import authenticate_user, create_access_token
from app.crud import portfolio as crud_portfolio
from app.core.settings_helper import get_site_settings
from app.db.base import Base
from app.db.session import engine
from app.utils.i18n import validate_language, get_translation, get_translated_field
from app.models.contact_submission import ContactSubmission

app = FastAPI(title="Architect Portfolio")

@app.exception_handler(NotAuthenticatedException)
async def not_auth_handler(request: Request, exc: NotAuthenticatedException):
    return RedirectResponse(url="/admin/login", status_code=302)

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

# Mount static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Templates
templates = Jinja2Templates(directory="app/templates")

# Add i18n helpers to Jinja2 globals
templates.env.globals["t"] = get_translation
templates.env.globals["get_translated_field"] = get_translated_field

# Include API routes
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])

# Language switching route
@app.get("/set-language/{lang}")
async def set_language(lang: str, response: Response, redirect_to: str = "/"):
    """Set language preference via cookie and redirect."""
    validated_lang = validate_language(lang)
    response = RedirectResponse(url=redirect_to, status_code=302)
    response.set_cookie(
        key="language",
        value=validated_lang,
        max_age=31536000,  # 1 year
        httponly=True,
        samesite="lax"
    )
    return response

# Frontend routes
@app.get("/", response_class=HTMLResponse)
async def landing_page(
    request: Request,
    db: Session = Depends(get_db),
    lang: Optional[str] = Query(default=None),
    language: Optional[str] = Cookie(default="pt")
):
    from app.models.image import PortfolioImage

    def repeat_to_six(urls: list[str]) -> list[str]:
        if not urls:
            return []

        repeated = []
        while len(repeated) < 6:
            repeated.extend(urls)
        return repeated[:6]

    selected_lang = validate_language(lang) if lang else validate_language(language)
    site_settings = get_site_settings()
    featured = crud_portfolio.get_featured_portfolios(db, limit=3)

    cube_projects = []

    def append_cube_project(project) -> bool:
        image_urls = [
            img.image_url
            for img in db.query(PortfolioImage)
            .filter(PortfolioImage.portfolio_id == project.id)
            .order_by(PortfolioImage.is_cover.desc(), PortfolioImage.id)
            .all()
        ]
        if image_urls:
            cube_projects.append({
                "id": project.id,
                "name": get_translated_field(project, "name", selected_lang) or project.name,
                "images": repeat_to_six(image_urls),
            })
            return True

        return False

    for project in featured:
        if len(cube_projects) == 3:
            break
        append_cube_project(project)

    return templates.TemplateResponse(request=request, name="landing.html", context={
        "request": request,
        "settings": site_settings,
        "lang": selected_lang,
        "cube_projects": cube_projects,
    })

@app.get("/home", response_class=HTMLResponse)
async def home(
    request: Request, 
    db: Session = Depends(get_db), 
    lang: Optional[str] = Query(default=None),
    language: Optional[str] = Cookie(default="pt")
):
    from app.crud import portfolio as crud_portfolio
    from app.models.image import PortfolioImage
    # Prioritize query param over cookie
    selected_lang = validate_language(lang) if lang else validate_language(language)
    site_settings = get_site_settings()
    featured = crud_portfolio.get_featured_portfolios(db)
    project_images_map = {}
    for p in featured:
        urls = [img.image_url for img in db.query(PortfolioImage).filter(PortfolioImage.portfolio_id == p.id).order_by(PortfolioImage.id).all()]
        if urls:
            project_images_map[str(p.id)] = urls
    return templates.TemplateResponse(request=request, name="index.html", context={
        "request": request,
        "featured_portfolios": featured,
        "settings": site_settings,
        "project_images_map": project_images_map,
        "lang": selected_lang,
    })

@app.get("/portfolio", response_class=HTMLResponse)
async def portfolio_page(
    request: Request, 
    db: Session = Depends(get_db), 
    lang: Optional[str] = Query(default=None),
    language: Optional[str] = Cookie(default="pt")
):
    from app.crud import portfolio as crud_portfolio
    selected_lang = validate_language(lang) if lang else validate_language(language)
    site_settings = get_site_settings()
    portfolios = crud_portfolio.get_portfolios(db, skip=0, limit=100)
    return templates.TemplateResponse(request=request, name="portfolio.html", context={"request": request, "portfolios": portfolios, "settings": site_settings, "lang": selected_lang})

@app.get("/portfolio/{portfolio_id}", response_class=HTMLResponse)
async def portfolio_detail(
    request: Request, 
    portfolio_id: int, 
    db: Session = Depends(get_db), 
    lang: Optional[str] = Query(default=None),
    language: Optional[str] = Cookie(default="pt")
):
    from app.crud import portfolio as crud_portfolio
    selected_lang = validate_language(lang) if lang else validate_language(language)
    site_settings = get_site_settings()
    portfolio = crud_portfolio.get_portfolio(db, portfolio_id=portfolio_id)
    if not portfolio:
        return RedirectResponse(url="/portfolio", status_code=302)
    return templates.TemplateResponse(request=request, name="portfolio_detail.html", context={"request": request, "portfolio": portfolio, "settings": site_settings, "lang": selected_lang})

@app.get("/about", response_class=HTMLResponse)
async def about(
    request: Request, 
    db: Session = Depends(get_db), 
    lang: Optional[str] = Query(default=None),
    language: Optional[str] = Cookie(default="pt")
):
    selected_lang = validate_language(lang) if lang else validate_language(language)
    site_settings = get_site_settings()
    featured = crud_portfolio.get_featured_portfolios(db)
    return templates.TemplateResponse(
        request=request,
        name="about.html",
        context={"request": request, "featured_portfolios": featured, "settings": site_settings, "lang": selected_lang},
    )

@app.get("/contact", response_class=HTMLResponse)
async def contact(
    request: Request, 
    lang: Optional[str] = Query(default=None),
    language: Optional[str] = Cookie(default="pt")
):
    selected_lang = validate_language(lang) if lang else validate_language(language)
    site_settings = get_site_settings()
    return templates.TemplateResponse(request=request, name="contact.html", context={"request": request, "settings": site_settings, "lang": selected_lang})

@app.post("/contact", response_class=HTMLResponse)
async def contact_form(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    message: str = Form(...),
    fax: str = Form(""),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timedelta, timezone
    from app.core.email import send_contact_email

    # Honeypot: if hidden field is filled, silently reject
    if fax:
        print(f"Honeypot triggered from {request.client.host}")
        return RedirectResponse(url="/contact?success=1", status_code=302)

    # Rate limit: max 5 submissions per IP per hour
    ip = request.client.host
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
    recent = db.query(ContactSubmission).filter(
        ContactSubmission.ip_address == ip,
        ContactSubmission.created_at >= cutoff,
    ).count()
    if recent >= 5:
        print(f"Rate limit hit for {ip} ({recent} submissions in last hour)")
        return templates.TemplateResponse(
            request=request,
            name="contact.html",
            context={
                "request": request,
                "settings": get_site_settings(),
                "lang": request.cookies.get("language", "pt"),
                "error": "Too many submissions. Please try again later.",
            },
        )

    # Log submission
    db.add(ContactSubmission(ip_address=ip, created_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    db.commit()

    site_settings = get_site_settings()
    to_email = site_settings.get("contact_email")
    if to_email:
        send_contact_email(to_email=to_email, name=name, from_email=email, message=message)
    else:
        print(f"No contact email configured — submission from {name} ({email}): {message}")

    return RedirectResponse(url="/contact?success=1", status_code=302)

# Admin routes
@app.get("/admin/login", response_class=HTMLResponse)
async def admin_login(request: Request, error: str = None):
    site_settings = get_site_settings()
    return templates.TemplateResponse(request=request, name="admin/login.html", context={"request": request, "error": error, "settings": site_settings})

@app.post("/admin/login")
async def admin_login_post(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    from datetime import datetime, timedelta, timezone
    from app.models.contact_submission import ContactSubmission

    # Rate limit: max 10 login attempts per IP per 15 minutes
    ip = request.client.host
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=15)
    recent = db.query(ContactSubmission).filter(
        ContactSubmission.ip_address == ip,
        ContactSubmission.created_at >= cutoff,
    ).count()
    if recent >= 10:
        return templates.TemplateResponse(
            request=request,
            name="admin/login.html",
            context={
                "request": request,
                "error": "Too many login attempts. Please try again later.",
                "settings": get_site_settings(),
            },
        )

    # Log login attempt
    db.add(ContactSubmission(ip_address=ip, created_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    db.commit()

    user = authenticate_user(db, username, password)
    if not user:
        site_settings = get_site_settings()
        return templates.TemplateResponse(
            request=request, 
            name="admin/login.html", 
            context={"request": request, "error": "Invalid credentials", "settings": site_settings}
        )
    access_token = create_access_token(data={"sub": user.username})
    response = RedirectResponse(url="/admin/dashboard", status_code=302)
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="lax",
    )
    return response

@app.get("/admin/logout")
async def admin_logout():
    response = RedirectResponse(url="/admin/login", status_code=302)
    response.delete_cookie(key="access_token")
    return response

@app.get("/admin/dashboard", response_class=HTMLResponse)
async def admin_dashboard(request: Request, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    site_settings = get_site_settings()
    portfolios = crud_portfolio.get_portfolios(db, skip=0, limit=100)
    return templates.TemplateResponse(
        request=request, 
        name="admin/dashboard.html", 
        context={"request": request, "projects": portfolios, "settings": site_settings}
    )

@app.get("/admin/projects/create", response_class=HTMLResponse)
async def create_project_form(request: Request, _admin: User = Depends(get_admin_user)):
    site_settings = get_site_settings()
    return templates.TemplateResponse(request=request, name="admin/project_form.html", context={"request": request, "settings": site_settings})

@app.post("/admin/projects/create")
async def create_project(
    request: Request,
    name_pt: str = Form(...),
    name_en: str = Form(None),
    description_pt: str = Form(None),
    description_en: str = Form(None),
    year: int = Form(None),
    location_pt: str = Form(None),
    location_en: str = Form(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    from app.models.portfolio import Portfolio
    portfolio = Portfolio(
        name_pt=name_pt,
        name_en=name_en,
        description_pt=description_pt,
        description_en=description_en,
        year=year,
        location_pt=location_pt,
        location_en=location_en,
        # Keep legacy fields for backward compatibility
        name=name_pt,
        description=description_pt,
        location=location_pt
    )
    db.add(portfolio)
    db.commit()
    return RedirectResponse(url="/admin/dashboard", status_code=302)

@app.get("/admin/projects/{portfolio_id}/edit", response_class=HTMLResponse)
async def edit_project_form(request: Request, portfolio_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    site_settings = get_site_settings()
    portfolio = crud_portfolio.get_portfolio(db, portfolio_id=portfolio_id)
    if not portfolio:
        return RedirectResponse(url="/admin/dashboard", status_code=302)
    return templates.TemplateResponse(
        request=request, 
        name="admin/project_form.html", 
        context={"request": request, "project": portfolio, "settings": site_settings}
    )

@app.post("/admin/projects/{portfolio_id}/edit")
async def edit_project(
    request: Request,
    portfolio_id: int,
    name_pt: str = Form(...),
    name_en: str = Form(None),
    description_pt: str = Form(None),
    description_en: str = Form(None),
    year: int = Form(None),
    location_pt: str = Form(None),
    location_en: str = Form(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    portfolio = crud_portfolio.get_portfolio(db, portfolio_id=portfolio_id)
    if portfolio:
        portfolio.name_pt = name_pt
        portfolio.name_en = name_en
        portfolio.description_pt = description_pt
        portfolio.description_en = description_en
        portfolio.year = year
        portfolio.location_pt = location_pt
        portfolio.location_en = location_en
        # Keep legacy fields for backward compatibility
        portfolio.name = name_pt
        portfolio.description = description_pt
        portfolio.location = location_pt
        db.commit()
    return RedirectResponse(url="/admin/dashboard", status_code=302)

@app.get("/admin/projects/{portfolio_id}/delete")
async def delete_project(portfolio_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    crud_portfolio.delete_portfolio(db=db, portfolio_id=portfolio_id)
    return RedirectResponse(url="/admin/dashboard", status_code=302)

@app.post("/admin/projects/{portfolio_id}/toggle-featured")
async def toggle_featured(portfolio_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    portfolio = crud_portfolio.get_portfolio(db, portfolio_id=portfolio_id)
    if portfolio:
        from app.schemas.portfolio import PortfolioUpdate
        crud_portfolio.update_portfolio(db, portfolio_id, PortfolioUpdate(is_featured=not portfolio.is_featured))
    return RedirectResponse(url="/admin/dashboard", status_code=302)

@app.get("/admin/settings", response_class=HTMLResponse)
async def admin_settings(request: Request, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    from app.models.setting import SiteSetting, HeroImage
    from app.models.image import PortfolioImage, TechnicalImage
    from app.models.portfolio import Portfolio
    from sqlalchemy.orm import joinedload
    from collections import defaultdict
    
    settings_list = {r.key: r.value for r in db.query(SiteSetting).all()}
    hero_images = db.query(HeroImage).options(joinedload(HeroImage.portfolio)).order_by(HeroImage.sort_order).all()
    site_settings = get_site_settings()
    
    # Load all project images with their portfolio data
    portfolio_images = db.query(PortfolioImage).options(joinedload(PortfolioImage.portfolio)).all()
    technical_images = db.query(TechnicalImage).options(joinedload(TechnicalImage.portfolio)).all()
    all_project_images = portfolio_images + technical_images
    
    # Group images by portfolio
    images_by_portfolio = defaultdict(list)
    for img in all_project_images:
        if img.portfolio:
            images_by_portfolio[img.portfolio].append(img)
    
    # Sort portfolios by name
    portfolios_with_images = sorted(images_by_portfolio.items(), key=lambda x: x[0].name or '')
    
    existing_hero_urls = {h.image_url for h in hero_images}
    return templates.TemplateResponse(
        request=request,
        name="admin/settings.html",
        context={
            "request": request,
            "settings_list": settings_list,
            "hero_images": hero_images,
            "settings": site_settings,
            "portfolios_with_images": portfolios_with_images,
            "existing_hero_urls": existing_hero_urls,
        }
    )

@app.post("/admin/settings/site-name")
async def update_site_name(
    site_name: str = Form(...),
    copyright: str = Form(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    from app.models.setting import SiteSetting
    for key, value in {"site_name": site_name, "copyright": copyright}.items():
        if value is not None:
            row = db.query(SiteSetting).filter(SiteSetting.key == key).first()
            if row:
                row.value = value
            else:
                db.add(SiteSetting(key=key, value=value))
    db.commit()
    return RedirectResponse(url="/admin/settings", status_code=302)

@app.post("/admin/settings/taglines")
async def update_taglines(
    request: Request,
    taglines: str = Form(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    from app.models.setting import SiteSetting
    row = db.query(SiteSetting).filter(SiteSetting.key == "tagline").first()
    if row:
        row.value = taglines
    else:
        db.add(SiteSetting(key="tagline", value=taglines))
    db.commit()
    return RedirectResponse(url="/admin/settings", status_code=302)

@app.post("/admin/settings/logo")
async def upload_logo(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    from app.models.setting import SiteSetting
    import time
    upload_dir = Path("app/static/uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename).suffix or ".png"
    filename = f"logo{ext}"
    filepath = upload_dir / filename
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    
    # Add timestamp for cache-busting
    timestamp = int(time.time())
    logo_url = f"/static/uploads/{filename}?v={timestamp}"
    
    row = db.query(SiteSetting).filter(SiteSetting.key == "logo_path").first()
    if row:
        row.value = logo_url
    else:
        db.add(SiteSetting(key="logo_path", value=logo_url))
    db.commit()
    return RedirectResponse(url="/admin/settings", status_code=302)

# Standalone hero upload endpoint removed - now using add_hero_from_project instead
# which associates hero images with their source portfolio projects
# @app.post("/admin/settings/hero")
# async def upload_hero_image(
#     request: Request,
#     file: UploadFile = File(...),
#     caption_pt: str = Form(None),
#     caption_en: str = Form(None),
#     db: Session = Depends(get_db)
# ):
#     from app.models.setting import HeroImage
#     from sqlalchemy import func as sa_func
#     upload_dir = Path("app/static/uploads/hero")
#     upload_dir.mkdir(parents=True, exist_ok=True)
#     ext = Path(file.filename).suffix or ".jpg"
#     filename = f"hero_{uuid.uuid4().hex[:12]}{ext}"
#     filepath = upload_dir / filename
#     with open(filepath, "wb") as f:
#         shutil.copyfileobj(file.file, f)
#     max_order = db.query(sa_func.max(HeroImage.sort_order)).scalar() or 0
#     db.add(HeroImage(
#         image_url=f"/static/uploads/hero/{filename}",
#         caption_pt=caption_pt,
#         caption_en=caption_en,
#         caption=caption_pt,  # Legacy field
#         sort_order=max_order + 1
#     ))
#     db.commit()
#     return RedirectResponse(url="/admin/settings", status_code=302)

@app.get("/admin/settings/hero/{hero_id}/delete")
async def delete_hero_image(hero_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    from app.models.setting import HeroImage
    img = db.query(HeroImage).filter(HeroImage.id == hero_id).first()
    if img:
        filepath = Path("app") / img.image_url.lstrip("/")
        if filepath.exists():
            filepath.unlink()
        db.delete(img)
        db.commit()
    return RedirectResponse(url="/admin/settings", status_code=302)

@app.post("/admin/settings/hero/{hero_id}/caption")
async def update_hero_caption(
    hero_id: int,
    caption_pt: str = Form(""),
    caption_en: str = Form(""),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    from app.models.setting import HeroImage
    img = db.query(HeroImage).filter(HeroImage.id == hero_id).first()
    if img:
        img.caption_pt = caption_pt
        img.caption_en = caption_en
        img.caption = caption_pt  # Legacy field
        db.commit()
    return RedirectResponse(url="/admin/settings", status_code=302)

@app.get("/admin/settings/hero/add-from-project")
async def add_hero_from_project(image_url: str, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    from app.models.setting import HeroImage
    from app.models.image import PortfolioImage, TechnicalImage
    from sqlalchemy import func as sa_func
    
    # Check if already exists
    existing = db.query(HeroImage).filter(HeroImage.image_url == image_url).first()
    if not existing:
        # Find the portfolio_id from the source image
        portfolio_id = None
        source_img = db.query(PortfolioImage).filter(PortfolioImage.image_url == image_url).first()
        if source_img:
            portfolio_id = source_img.portfolio_id
        else:
            source_img = db.query(TechnicalImage).filter(TechnicalImage.image_url == image_url).first()
            if source_img:
                portfolio_id = source_img.portfolio_id
        
        max_order = db.query(sa_func.max(HeroImage.sort_order)).scalar() or 0
        db.add(HeroImage(
            image_url=image_url,
            portfolio_id=portfolio_id,
            sort_order=max_order + 1
        ))
        db.commit()
    return RedirectResponse(url="/admin/settings", status_code=302)

@app.post("/admin/settings/contact")
async def update_contact(
    request: Request,
    email: str = Form(None),
    phone: str = Form(None),
    address_pt: str = Form(None),
    address_en: str = Form(None),
    blurb_pt: str = Form(None),
    blurb_en: str = Form(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    from app.models.setting import SiteSetting
    updates = {
        "contact_email": email,
        "contact_phone": phone,
        "contact_address_pt": address_pt,
        "contact_address_en": address_en,
        "contact_blurb_pt": blurb_pt,
        "contact_blurb_en": blurb_en,
    }
    for key, value in updates.items():
        if value is not None:
            row = db.query(SiteSetting).filter(SiteSetting.key == key).first()
            if row:
                row.value = value
            else:
                db.add(SiteSetting(key=key, value=value))
    db.commit()
    return RedirectResponse(url="/admin/settings", status_code=302)

@app.post("/admin/settings/about")
async def update_about(
    request: Request,
    title_pt: str = Form(None),
    title_en: str = Form(None),
    body_pt: str = Form(None),
    body_en: str = Form(None),
    file: UploadFile = File(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    from app.models.setting import SiteSetting
    
    updates = {
        "about_title_pt": title_pt,
        "about_title_en": title_en,
        "about_body_pt": body_pt,
        "about_body_en": body_en,
    }
    
    for key, value in updates.items():
        if value is not None:
            row = db.query(SiteSetting).filter(SiteSetting.key == key).first()
            if row:
                row.value = value
            else:
                db.add(SiteSetting(key=key, value=value))
    
    if file and file.filename:
        upload_dir = Path("app/static/uploads")
        upload_dir.mkdir(parents=True, exist_ok=True)
        ext = Path(file.filename).suffix or ".jpg"
        filename = f"about_image{ext}"
        filepath = upload_dir / filename
        with open(filepath, "wb") as f:
            shutil.copyfileobj(file.file, f)
        img_url = f"/static/uploads/{filename}"
        row = db.query(SiteSetting).filter(SiteSetting.key == "about_image").first()
        if row:
            row.value = img_url
        else:
            db.add(SiteSetting(key="about_image", value=img_url))
    db.commit()
    return RedirectResponse(url="/admin/settings", status_code=302)

@app.post("/admin/projects/{portfolio_id}/upload-image")
async def upload_portfolio_image(
    portfolio_id: int,
    file: UploadFile = File(...),
    caption_pt: str = Form(None),
    caption_en: str = Form(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    portfolio = crud_portfolio.get_portfolio(db, portfolio_id=portfolio_id)
    if not portfolio:
        return RedirectResponse(url="/admin/dashboard", status_code=302)
    
    upload_dir = Path("app/static/uploads") / str(portfolio_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    suffix = Path(file.filename).suffix.lower()
    uid = uuid.uuid4().hex[:12]
    
    if suffix == ".pdf":
        import fitz
        temp = upload_dir / f"temp_{uid}.pdf"
        with open(temp, "wb") as f:
            shutil.copyfileobj(file.file, f)
        doc = fitz.open(temp)
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        filename = f"{portfolio_id}_{uid}.png"
        pix.save(str(upload_dir / filename))
        doc.close()
        temp.unlink()
    elif suffix in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        filename = f"{portfolio_id}_{uid}{suffix}"
        file_path = upload_dir / filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    else:
        return RedirectResponse(url=f"/admin/projects/{portfolio_id}/edit", status_code=302)
    
    from app.models.image import PortfolioImage
    
    image_url = f"/static/uploads/{portfolio_id}/{filename}"
    image = PortfolioImage(
        portfolio_id=portfolio_id,
        image_url=image_url,
        caption_pt=caption_pt,
        caption_en=caption_en,
        caption=caption_pt  # Legacy field
    )
    db.add(image)
    db.commit()
    
    return RedirectResponse(url=f"/admin/projects/{portfolio_id}/edit", status_code=302)

@app.post("/admin/projects/{portfolio_id}/upload-technical")
async def upload_technical_drawing(
    portfolio_id: int,
    file: UploadFile = File(...),
    caption_pt: str = Form(None),
    caption_en: str = Form(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    portfolio = crud_portfolio.get_portfolio(db, portfolio_id=portfolio_id)
    if not portfolio:
        return RedirectResponse(url="/admin/dashboard", status_code=302)
    
    upload_dir = Path("app/static/uploads") / str(portfolio_id) / "technical"
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    suffix = Path(file.filename).suffix.lower()
    uid = uuid.uuid4().hex[:12]
    
    if suffix == ".pdf":
        import fitz
        temp = upload_dir / f"temp_{uid}.pdf"
        with open(temp, "wb") as f:
            shutil.copyfileobj(file.file, f)
        doc = fitz.open(temp)
        page = doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        filename = f"{portfolio_id}_tech_{uid}.png"
        pix.save(str(upload_dir / filename))
        doc.close()
        temp.unlink()
    else:
        filename = f"{portfolio_id}_tech_{uid}{suffix}"
        file_path = upload_dir / filename
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    
    from app.models.image import TechnicalImage
    
    image_url = f"/static/uploads/{portfolio_id}/technical/{filename}"
    image = TechnicalImage(
        portfolio_id=portfolio_id,
        image_url=image_url,
        caption_pt=caption_pt,
        caption_en=caption_en,
        caption=caption_pt  # Legacy field
    )
    db.add(image)
    db.commit()
    
    return RedirectResponse(url=f"/admin/projects/{portfolio_id}/edit", status_code=302)

@app.get("/admin/images/{image_id}/delete")
async def delete_image(image_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    from app.models.image import PortfolioImage, TechnicalImage
    from pathlib import Path
    
    # Try to find image in both tables
    image = db.query(PortfolioImage).filter(PortfolioImage.id == image_id).first()
    if not image:
        image = db.query(TechnicalImage).filter(TechnicalImage.id == image_id).first()
    
    if not image:
        return RedirectResponse(url="/admin/dashboard", status_code=302)
    
    # Get portfolio_id before deleting
    portfolio_id = image.portfolio_id
    
    # Delete file from filesystem
    if image.image_url:
        file_path = Path("app") / image.image_url.lstrip("/")
        if file_path.exists():
            file_path.unlink()
    
    # Delete from database
    db.delete(image)
    db.commit()
    
    return RedirectResponse(url=f"/admin/projects/{portfolio_id}/edit", status_code=302)

@app.get("/admin/projects/{portfolio_id}/images/{image_id}/set-cover")
async def set_cover_image(portfolio_id: int, image_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    from app.models.image import PortfolioImage, TechnicalImage
    db.query(PortfolioImage).filter(PortfolioImage.portfolio_id == portfolio_id).update({"is_cover": False})
    db.query(TechnicalImage).filter(TechnicalImage.portfolio_id == portfolio_id).update({"is_cover": False})
    for model in (PortfolioImage, TechnicalImage):
        img = db.query(model).filter(model.id == image_id, model.portfolio_id == portfolio_id).first()
        if img:
            img.is_cover = True
            break
    db.commit()
    return RedirectResponse(url=f"/admin/projects/{portfolio_id}/edit", status_code=302)

@app.post("/admin/images/{image_id}/caption")
async def update_caption(
    image_id: int, 
    caption_pt: str = Form(""), 
    caption_en: str = Form(""), 
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    from app.models.image import PortfolioImage, TechnicalImage
    for model in (PortfolioImage, TechnicalImage):
        img = db.query(model).filter(model.id == image_id).first()
        if img:
            img.caption_pt = caption_pt
            img.caption_en = caption_en
            img.caption = caption_pt  # Legacy field
            db.commit()
            return RedirectResponse(url=f"/admin/projects/{img.portfolio_id}/edit", status_code=302)
    return RedirectResponse(url="/admin/dashboard", status_code=302)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
