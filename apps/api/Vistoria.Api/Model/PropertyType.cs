namespace Vistoria.Api.Model;

/// <summary>Tipo do imóvel. No JSON e no banco vai como string (<c>apartment</c>, <c>house</c>...).</summary>
public enum PropertyType
{
    Apartment,
    House,
    Commercial,
    Other,
}
